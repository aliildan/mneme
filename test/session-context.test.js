// test/session-context.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, realpath, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { buildSessionDigest } from "../src/cli/commands/session-context.js";
import { projectHash } from "../src/project/project-hash.js";
import { migrateProjectDb } from "../src/db/migrate.js";
import { recordMemory } from "../src/memory/record.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "mneme");

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

describe("sessionContext command (subprocess, isolated home)", () => {
  test("emits a digest when the project is indexed and has memory", async () => {
    const home = await mkdtemp(join(tmpdir(), "mneme-sc-home-"));
    const proj = await mkdtemp(join(tmpdir(), "mneme-sc-proj-"));
    try {
      const root = await realpath(proj);
      const hash = projectHash(root);
      const dbPath = join(home, "mneme", "projects", hash, "index.db");
      await mkdir(dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      migrateProjectDb(db);
      const gdb = join(home, "mneme", "global.db");
      await recordMemory(db, gdb, { kind: "todo", body: "ship session-context hook" });
      await recordMemory(db, gdb, { kind: "decision", body: "inject memory at SessionStart" });
      await recordMemory(db, gdb, { kind: "learning", body: "learning-should-not-appear" });
      db.close();

      const res = spawnSync(process.execPath, [BIN, "session-context"], {
        env: { ...process.env, OPENCLAUDE_HOME: home, MNEME_PROJECT_ROOT: root },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(res.status, 0);
      assert.match(res.stdout, /Project memory \(mneme\)/);
      assert.match(res.stdout, /ship session-context hook/);
      assert.match(res.stdout, /inject memory at SessionStart/);
      assert.doesNotMatch(res.stdout, /learning-should-not-appear/);
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(proj, { recursive: true, force: true });
    }
  });

  test("emits nothing when the project is not indexed", async () => {
    const home = await mkdtemp(join(tmpdir(), "mneme-sc-home-"));
    const proj = await mkdtemp(join(tmpdir(), "mneme-sc-proj-"));
    try {
      const root = await realpath(proj);
      const res = spawnSync(process.execPath, [BIN, "session-context"], {
        env: { ...process.env, OPENCLAUDE_HOME: home, MNEME_PROJECT_ROOT: root },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(res.status, 0);
      assert.equal(res.stdout, "");
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(proj, { recursive: true, force: true });
    }
  });
});
