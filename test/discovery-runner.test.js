import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDiscoveryResponse } from "../src/retrieval/discovery-prompt.js";

// Test the pure parsing logic without needing a live server
// Note: indices are 1-based (1..N) in the discovery protocol
describe("parseDiscoveryResponse", () => {
  test("parses valid keep/drop response (1-based indices)", () => {
    const result = parseDiscoveryResponse('{"keep":[1,2,4],"drop":[3,5]}', 5);
    assert.ok(result.ok, `expected ok=true, got: ${result.error}`);
    assert.deepEqual(result.keep.sort((a, b) => a - b), [1, 2, 4]);
    assert.deepEqual(result.drop.sort((a, b) => a - b), [3, 5]);
  });

  test("returns ok=false for invalid JSON", () => {
    const result = parseDiscoveryResponse("not json at all", 5);
    assert.equal(result.ok, false);
  });

  test("returns ok=false when indices don't cover all candidates", () => {
    // 5 candidates (1-5), but only 4 indices provided
    const result = parseDiscoveryResponse('{"keep":[1,2],"drop":[3]}', 5);
    assert.equal(result.ok, false, "should fail when not all indices covered");
  });

  test("returns ok=false when an index from 1..N is missing", () => {
    // 5 candidates (1-5), index 3 is missing from both keep and drop
    const result = parseDiscoveryResponse('{"keep":[1,2],"drop":[4,5]}', 5);
    assert.equal(result.ok, false, "should fail when index 3 is missing");
  });

  test("handles all-keep response", () => {
    const result = parseDiscoveryResponse('{"keep":[1,2,3],"drop":[]}', 3);
    assert.ok(result.ok, "valid all-keep should parse");
    assert.deepEqual(result.keep.sort((a, b) => a - b), [1, 2, 3]);
    assert.deepEqual(result.drop, []);
  });

  test("handles all-drop response", () => {
    const result = parseDiscoveryResponse('{"keep":[],"drop":[1,2,3]}', 3);
    assert.ok(result.ok, "valid all-drop should parse");
    assert.deepEqual(result.keep, []);
    assert.deepEqual(result.drop.sort((a, b) => a - b), [1, 2, 3]);
  });

  test("returns ok=false for missing keep or drop keys", () => {
    const r1 = parseDiscoveryResponse('{"keep":[1,2,3]}', 3);
    assert.equal(r1.ok, false);
    const r2 = parseDiscoveryResponse('{"drop":[1,2,3]}', 3);
    assert.equal(r2.ok, false);
  });

  test("strips code fences and parses correctly", () => {
    const result = parseDiscoveryResponse('```json\n{"keep":[1],"drop":[2,3]}\n```', 3);
    assert.ok(result.ok, `expected ok after stripping code fences, got: ${result.error}`);
  });
});

describe("discovery fallback behavior (unit)", () => {
  test("runDiscovery with null model returns original ranked list unchanged", async () => {
    const { runDiscovery } = await import("../src/retrieval/discovery-runner.js");

    const fakeRanked = [
      { id: 1, name: "foo", score: 1.0 },
      { id: 2, name: "bar", score: 0.8 },
    ];

    // Pass a null model → should skip discovery and return full list
    const result = await runDiscovery(fakeRanked, null, {
      task: "test",
      hint: null,
      model: null,
      config: {},
    });

    // Should return the original ranked list unchanged (no model = no narrowing)
    assert.deepEqual(result, fakeRanked);
  });

  test("runDiscovery with empty ranked list returns empty array", async () => {
    const { runDiscovery } = await import("../src/retrieval/discovery-runner.js");

    const result = await runDiscovery([], null, {
      task: "test",
      hint: null,
      model: "some-model",
      config: {},
    });

    assert.deepEqual(result, []);
  });
});
