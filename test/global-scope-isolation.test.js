import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDb, openGlobalDb } from "../src/db/open.js";
import { migrateProjectDb, migrateGlobalDb } from "../src/db/migrate.js";
import { recordMemory } from "../src/memory/record.js";
import { recallMemory } from "../src/memory/recall.js";

let tmpDir;
let projectADb;
let projectBDb;
let globalDbPath;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-isolation-"));
  globalDbPath = join(tmpDir, "global.db");

  projectADb = await openProjectDb("hash-project-a", join(tmpDir, "projectA.db"));
  migrateProjectDb(projectADb);

  projectBDb = await openProjectDb("hash-project-b", join(tmpDir, "projectB.db"));
  migrateProjectDb(projectBDb);

  const gDb = await openGlobalDb(globalDbPath);
  migrateGlobalDb(gDb);
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("per-project isolation", () => {
  test("project A memory does not appear when recalling from project B", async () => {
    const uniqueMarker = "project-a-only-unique-marker-99887766";
    await recordMemory(projectADb, globalDbPath, {
      kind: "learning",
      body: `Project A secret: ${uniqueMarker}`,
    });

    // Recall from project B — should NOT see project A memory
    const matches = await recallMemory(projectBDb, globalDbPath, { query: uniqueMarker, scope: "project" });
    const found = matches.find((m) => m.body.includes(uniqueMarker));
    assert.ok(!found, "project A memory leaked into project B recall");
  });

  test("global memory appears in both projects", async () => {
    const globalMarker = "global-memory-visible-everywhere-44332211";
    await recordMemory(projectADb, globalDbPath, {
      kind: "decision",
      body: `Global rule: ${globalMarker}`,
      scope: "global",
    });

    // Both projects should see global memory
    const fromA = await recallMemory(projectADb, globalDbPath, { query: globalMarker });
    const fromB = await recallMemory(projectBDb, globalDbPath, { query: globalMarker });

    const inA = fromA.find((m) => m.body.includes(globalMarker));
    const inB = fromB.find((m) => m.body.includes(globalMarker));
    assert.ok(inA, "global memory not visible from project A");
    assert.ok(inB, "global memory not visible from project B");
  });

  test("project-scoped memory is only visible in its own project when scope=project", async () => {
    const markerA = "ONLY-IN-A-55443322";
    const markerB = "ONLY-IN-B-66554433";

    await recordMemory(projectADb, globalDbPath, { kind: "learning", body: markerA });
    await recordMemory(projectBDb, globalDbPath, { kind: "learning", body: markerB });

    // Ask explicitly for project scope only
    const aRecall = await recallMemory(projectADb, globalDbPath, { query: markerB, scope: "project" });
    assert.ok(!aRecall.find((m) => m.body.includes(markerB)), "B marker leaked into A");

    const bRecall = await recallMemory(projectBDb, globalDbPath, { query: markerA, scope: "project" });
    assert.ok(!bRecall.find((m) => m.body.includes(markerA)), "A marker leaked into B");
  });

  test("scope field is preserved correctly", async () => {
    const projectResult = await recordMemory(projectADb, globalDbPath, {
      kind: "learning",
      body: "project-scoped test memory",
      scope: "project",
    });
    assert.equal(projectResult.scope, "project");

    const globalResult = await recordMemory(projectADb, globalDbPath, {
      kind: "decision",
      body: "global-scoped test memory",
      scope: "global",
    });
    assert.equal(globalResult.scope, "global");
  });
});
