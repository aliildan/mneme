import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../src/mcp/server.js";

const byName = (n) => TOOLS.find((t) => t.name === n);

describe("MCP tool descriptions steer the agent", () => {
  test("get_context positions itself over grep", () => {
    const d = byName("mneme_get_context").description.toLowerCase();
    assert.match(d, /grep/);
    assert.match(d, /where|how/);
  });
  test("record_memory says when to record", () => {
    assert.match(byName("mneme_record_memory").description.toLowerCase(), /decision|gotcha/);
    assert.match(byName("mneme_record_memory").description, /verbatim|exact/i);
  });
  test("recall_memory says recall before re-deriving", () => {
    assert.match(byName("mneme_recall_memory").description.toLowerCase(), /before|re-?deriv/);
  });
});
