// test/session-context.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSessionDigest } from "../src/cli/commands/session-context.js";

const mem = (kind, body, created_at = Date.now()) => ({ kind, body, created_at });

describe("buildSessionDigest", () => {
  test("returns empty string when there are no memories", () => {
    assert.equal(buildSessionDigest([], {}), "");
  });

  test("includes only configured kinds and groups them with headers", () => {
    const out = buildSessionDigest([
      mem("todo", "wire up SessionStart hook"),
      mem("decision", "use scoped npm name"),
      mem("learning", "tree-sitter wasm is slower"),
    ], { kinds: ["todo", "decision", "gotcha"] });
    assert.match(out, /## Project memory \(mneme\)/);
    assert.match(out, /\*\*Open todos\*\*/);
    assert.match(out, /wire up SessionStart hook/);
    assert.match(out, /use scoped npm name/);
    assert.doesNotMatch(out, /tree-sitter wasm is slower/, "learning excluded by default kinds");
  });

  test("orders todo before decision before gotcha", () => {
    const out = buildSessionDigest([
      mem("gotcha", "AAA"),
      mem("decision", "BBB"),
      mem("todo", "CCC"),
    ], { kinds: ["todo", "decision", "gotcha"] });
    assert.ok(out.indexOf("Open todos") < out.indexOf("Decisions"));
    assert.ok(out.indexOf("Decisions") < out.indexOf("Gotchas"));
  });

  test("respects maxItems", () => {
    const many = Array.from({ length: 30 }, (_, i) => mem("todo", `todo ${i}`, i));
    const out = buildSessionDigest(many, { kinds: ["todo"], maxItems: 5 });
    assert.equal((out.match(/- todo /g) || []).length, 5);
  });

  test("respects tokenBudget but always keeps at least one item", () => {
    const big = "x".repeat(4000); // ~1000 tokens at chars/4
    const out = buildSessionDigest([mem("todo", big), mem("todo", big)], { kinds: ["todo"], tokenBudget: 800 });
    assert.equal((out.match(/^- /gm) || []).length, 1, "only the first fits under budget");
  });

  test("truncates long bodies to perItemCharCap with an ellipsis", () => {
    const out = buildSessionDigest([mem("todo", "y".repeat(500))], { kinds: ["todo"], perItemCharCap: 50 });
    assert.match(out, /y{49}…/);
  });

  test("skips items with empty/non-string bodies", () => {
    const out = buildSessionDigest([mem("todo", ""), mem("todo", "real")], { kinds: ["todo"] });
    assert.equal((out.match(/^- /gm) || []).length, 1);
  });
});

import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("sessionContext command", () => {
  async function withProject(run) {
    const home = await mkdtemp(join(tmpdir(), "mneme-sc-home-"));
    const proj = await mkdtemp(join(tmpdir(), "mneme-sc-proj-"));
    const prevHome = process.env.OPENCLAUDE_HOME;
    const prevRoot = process.env.MNEME_PROJECT_ROOT;
    process.env.OPENCLAUDE_HOME = home;
    process.env.MNEME_PROJECT_ROOT = await realpath(proj);
    let out = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out += s; return true; };
    try {
      await run({ home, root: process.env.MNEME_PROJECT_ROOT, getOut: () => out });
    } finally {
      process.stdout.write = origWrite;
      if (prevHome === undefined) delete process.env.OPENCLAUDE_HOME; else process.env.OPENCLAUDE_HOME = prevHome;
      if (prevRoot === undefined) delete process.env.MNEME_PROJECT_ROOT; else process.env.MNEME_PROJECT_ROOT = prevRoot;
      await rm(home, { recursive: true, force: true });
      await rm(proj, { recursive: true, force: true });
    }
  }

  test("emits a digest when the project is indexed and has memory", async () => {
    await withProject(async ({ root, getOut }) => {
      const { projectHash } = await import("../src/project/project-hash.js");
      const { projectDbPath } = await import("../src/config/paths.js");
      const { openProjectDb } = await import("../src/db/open.js");
      const { migrateProjectDb } = await import("../src/db/migrate.js");
      const { recordMemory } = await import("../src/memory/record.js");
      const { sessionContext } = await import("../src/cli/commands/session-context.js");

      const hash = projectHash(root);
      const dbPath = projectDbPath(hash);
      const db = await openProjectDb(hash, dbPath);
      migrateProjectDb(db);
      const gdb = join(process.env.OPENCLAUDE_HOME, "mneme", "global.db");
      await recordMemory(db, gdb, { kind: "todo", body: "ship session-context hook" });
      await recordMemory(db, gdb, { kind: "decision", body: "inject memory at SessionStart" });
      await recordMemory(db, gdb, { kind: "learning", body: "learning-should-not-appear" });

      await sessionContext();
      const out = getOut();
      assert.match(out, /Project memory \(mneme\)/);
      assert.match(out, /ship session-context hook/);
      assert.match(out, /inject memory at SessionStart/);
      assert.doesNotMatch(out, /learning-should-not-appear/);
    });
  });

  test("emits nothing when the project is not indexed", async () => {
    await withProject(async ({ getOut }) => {
      const { sessionContext } = await import("../src/cli/commands/session-context.js");
      await sessionContext();
      assert.equal(getOut(), "");
    });
  });
});
