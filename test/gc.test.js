import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDb, openGlobalDb } from "../src/db/open.js";
import { migrateProjectDb, migrateGlobalDb } from "../src/db/migrate.js";
import { gcMemory } from "../src/memory/gc.js";

let tmpDir;
let projectDb;
let globalDbPath;

const DAY_MS = 24 * 60 * 60 * 1000;

function insertMemory(db, { body, kind = "learning", tags = null, recallCount = 0, daysAgo = 0 }) {
  const created_at = Date.now() - daysAgo * DAY_MS;
  const tagsJson = tags ? JSON.stringify(tags) : null;
  db.prepare(`
    INSERT INTO memory (kind, body, scope, source, tags, recall_count, created_at)
    VALUES (?, ?, 'project', 'agent', ?, ?, ?)
  `).run(kind, body, tagsJson, recallCount, created_at);
  return db.prepare("SELECT id FROM memory WHERE body = ?").get(body)?.id;
}

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-gc-"));
  globalDbPath = join(tmpDir, "global.db");
  projectDb = await openProjectDb("gc-test", join(tmpDir, "gc.db"));
  migrateProjectDb(projectDb);
  const gDb = await openGlobalDb(globalDbPath);
  migrateGlobalDb(gDb);
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("gcMemory — decay rules", () => {
  test("old memory with recall_count=0 is soft-deleted", async () => {
    const id = insertMemory(projectDb, {
      body: "old-zero-recall-GC-test",
      daysAgo: 45,
      recallCount: 0,
    });

    await gcMemory(projectDb, globalDbPath, { olderThanDays: 30 });

    const row = projectDb.prepare("SELECT * FROM memory WHERE id = ?").get(id);
    assert.ok(row.forgotten_at != null, "expected forgotten_at to be set");
  });

  test("recent memory is NOT soft-deleted even with recall_count=0", async () => {
    const id = insertMemory(projectDb, {
      body: "recent-zero-recall-GC-test",
      daysAgo: 5,
      recallCount: 0,
    });

    await gcMemory(projectDb, globalDbPath, { olderThanDays: 30 });

    const row = projectDb.prepare("SELECT * FROM memory WHERE id = ?").get(id);
    assert.ok(row.forgotten_at == null, "recent memory should not be soft-deleted");
  });

  test("old memory with recall_count > 0 is NOT soft-deleted", async () => {
    const id = insertMemory(projectDb, {
      body: "old-recalled-GC-test",
      daysAgo: 90,
      recallCount: 3,
    });

    await gcMemory(projectDb, globalDbPath, { olderThanDays: 30 });

    const row = projectDb.prepare("SELECT * FROM memory WHERE id = ?").get(id);
    assert.ok(row.forgotten_at == null, "recalled memory should not be GC'd");
  });

  test("pinned memory is NEVER soft-deleted regardless of age", async () => {
    const id = insertMemory(projectDb, {
      body: "pinned-ancient-GC-test",
      daysAgo: 365,
      recallCount: 0,
      tags: ["pinned"],
    });

    await gcMemory(projectDb, globalDbPath, { olderThanDays: 7 });

    const row = projectDb.prepare("SELECT * FROM memory WHERE id = ?").get(id);
    assert.ok(row.forgotten_at == null, "pinned memory should never be soft-deleted");
  });

  test("already-forgotten memories are not touched again", async () => {
    const id = insertMemory(projectDb, {
      body: "already-forgotten-GC-test",
      daysAgo: 60,
      recallCount: 0,
    });

    const alreadyForgottenAt = Date.now() - 10000;
    projectDb.prepare("UPDATE memory SET forgotten_at = ? WHERE id = ?").run(alreadyForgottenAt, id);

    await gcMemory(projectDb, globalDbPath, { olderThanDays: 30 });

    const row = projectDb.prepare("SELECT * FROM memory WHERE id = ?").get(id);
    // forgotten_at should not have been reset to a newer value
    assert.equal(row.forgotten_at, alreadyForgottenAt, "forgotten_at should not change for already-forgotten rows");
  });

  test("rows are soft-deleted (forgotten_at set), never physically deleted", async () => {
    const id = insertMemory(projectDb, {
      body: "verify-soft-delete-GC-test",
      daysAgo: 50,
      recallCount: 0,
    });

    await gcMemory(projectDb, globalDbPath, { olderThanDays: 30 });

    // Row must still exist
    const row = projectDb.prepare("SELECT * FROM memory WHERE id = ?").get(id);
    assert.ok(row, "row must not be physically deleted");
    assert.ok(row.forgotten_at != null, "row must be soft-deleted");
    assert.equal(row.body, "verify-soft-delete-GC-test", "body must be preserved verbatim");
  });

  test("gcMemory returns count of soft-deleted rows", async () => {
    // Insert 3 old zero-recall memories
    for (let i = 0; i < 3; i++) {
      insertMemory(projectDb, {
        body: `gc-count-test-${i}-${Date.now()}`,
        daysAgo: 60,
        recallCount: 0,
      });
    }

    const result = await gcMemory(projectDb, globalDbPath, { olderThanDays: 30 });
    assert.ok(typeof result.softDeleted === "number", "expected softDeleted count");
    assert.ok(result.softDeleted >= 3, `expected at least 3 softDeleted, got ${result.softDeleted}`);
  });
});
