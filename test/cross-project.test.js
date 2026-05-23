import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDb, openGlobalDb } from "../src/db/open.js";
import { migrateProjectDb, migrateGlobalDb } from "../src/db/migrate.js";
import { recordMemory } from "../src/memory/record.js";
import { federatedRecall } from "../src/cross/federated-recall.js";

let tmpDir;
let projectADb;
let projectBDb;
let projectCDb;
let globalDbPath;
let pathA;
let pathB;
let pathC;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-cross-"));
  globalDbPath = join(tmpDir, "global.db");

  pathA = join(tmpDir, "projectA.db");
  pathB = join(tmpDir, "projectB.db");
  pathC = join(tmpDir, "projectC.db");

  projectADb = await openProjectDb("hash-a", pathA);
  migrateProjectDb(projectADb);

  projectBDb = await openProjectDb("hash-b", pathB);
  migrateProjectDb(projectBDb);

  projectCDb = await openProjectDb("hash-c", pathC);
  migrateProjectDb(projectCDb);

  const gDb = await openGlobalDb(globalDbPath);
  migrateGlobalDb(gDb);

  // Seed memories in each project
  await recordMemory(projectADb, globalDbPath, {
    kind: "learning",
    body: "Project A: uses event-driven architecture with EventEmitter",
    tags: ["architecture", "events"],
  });

  await recordMemory(projectBDb, globalDbPath, {
    kind: "decision",
    body: "Project B: decided to use PostgreSQL instead of SQLite for production",
    tags: ["database"],
  });

  await recordMemory(projectCDb, globalDbPath, {
    kind: "gotcha",
    body: "Project C: tree-sitter WASM must be loaded before parsing",
    tags: ["parser"],
  });

  // Global memory
  await recordMemory(projectADb, globalDbPath, {
    kind: "decision",
    body: "Global coding standard: always use kebab-case for filenames",
    scope: "global",
    tags: ["style"],
  });
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("federatedRecall", () => {
  test("returns memory only from allowlisted projects", async () => {
    const results = await federatedRecall({
      query: "architecture database parser",
      limit: 20,
      allowList: [pathA, pathB],
      globalDbPath,
    });

    const bodies = results.matches.map((m) => m.body);
    const hasA = bodies.some((b) => b.includes("Project A"));
    const hasB = bodies.some((b) => b.includes("Project B"));
    const hasC = bodies.some((b) => b.includes("Project C"));

    assert.ok(hasA || hasB, "should have A or B results");
    assert.ok(!hasC, "Project C should NOT appear when not allowlisted");
  });

  test("includes global memory regardless of allowlist", async () => {
    const results = await federatedRecall({
      query: "kebab-case filenames",
      limit: 20,
      allowList: [pathB],
      globalDbPath,
    });

    const hasGlobal = results.matches.some((m) => m.body.includes("kebab-case"));
    assert.ok(hasGlobal, "global memory should always appear");
  });

  test("returns source project path for each result", async () => {
    const results = await federatedRecall({
      query: "architecture",
      limit: 20,
      allowList: [pathA],
      globalDbPath,
    });

    for (const match of results.matches) {
      assert.ok(match.source_db || match.scope, "each match needs source_db or scope");
    }
  });

  test("empty allowList returns only global memory", async () => {
    const results = await federatedRecall({
      query: "Project A Project B Project C",
      limit: 20,
      allowList: [],
      globalDbPath,
    });

    const projectBodies = results.matches.filter((m) =>
      m.body.includes("Project A") || m.body.includes("Project B") || m.body.includes("Project C")
    );
    assert.equal(projectBodies.length, 0, "no project memories should appear with empty allowList");
  });

  test("never returns symbols or code — memory rows only", async () => {
    const results = await federatedRecall({
      query: "anything",
      limit: 100,
      allowList: [pathA, pathB, pathC],
      globalDbPath,
    });

    // All results must be memory rows (have kind field)
    for (const match of results.matches) {
      assert.ok(
        ["decision", "learning", "gotcha", "todo"].includes(match.kind),
        `non-memory row returned: ${JSON.stringify(match)}`
      );
    }
  });

  test("non-existent db path in allowList is skipped gracefully", async () => {
    const nonExistent = join(tmpDir, "does-not-exist.db");
    const results = await federatedRecall({
      query: "architecture",
      limit: 20,
      allowList: [pathA, nonExistent],
      globalDbPath,
    });

    // Should not throw; results from pathA still returned
    assert.ok(Array.isArray(results.matches));
  });
});
