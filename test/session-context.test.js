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
