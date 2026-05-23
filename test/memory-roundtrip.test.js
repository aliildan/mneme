import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDb, openGlobalDb } from "../src/db/open.js";
import { migrateProjectDb, migrateGlobalDb } from "../src/db/migrate.js";
import { recordMemory } from "../src/memory/record.js";
import { recallMemory, listMemories } from "../src/memory/recall.js";
import { gcMemory } from "../src/memory/gc.js";

let tmpDir;
let projectDb;
let globalDbPath;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-memory-"));
  globalDbPath = join(tmpDir, "global.db");

  projectDb = await openProjectDb("proj-test", join(tmpDir, "project.db"));
  migrateProjectDb(projectDb);
  const gDb = await openGlobalDb(globalDbPath);
  migrateGlobalDb(gDb);
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("memory roundtrip", () => {
  test("record and recall a decision", async () => {
    const result = await recordMemory(projectDb, globalDbPath, {
      kind: "decision",
      body: "Use WAL mode for SQLite to improve concurrency.",
      task: "setup database",
      files: ["src/db/open.js"],
      identifiers: ["openProjectDb"],
      tags: ["sqlite", "performance"],
    });

    assert.ok(result.id > 0, "expected positive id");
    assert.equal(result.scope, "project");

    const matches = await recallMemory(projectDb, globalDbPath, {
      query: "WAL mode SQLite concurrency",
    });

    assert.ok(Array.isArray(matches) && matches.length > 0, "expected at least one match");
    const match = matches.find((m) => m.id === result.id);
    assert.ok(match, "recorded memory not found in recall");
    assert.equal(match.kind, "decision");
    assert.equal(match.body, "Use WAL mode for SQLite to improve concurrency.");
  });

  test("verbatim body preserved exactly", async () => {
    const verbatim = 'Error: ENOENT: no such file or directory, open "/home/user/.config/mneme.json"';
    await recordMemory(projectDb, globalDbPath, {
      kind: "gotcha",
      body: verbatim,
    });

    const matches = await recallMemory(projectDb, globalDbPath, { query: "ENOENT config mneme" });
    const match = matches.find((m) => m.body === verbatim);
    assert.ok(match, "verbatim body not found");
    assert.equal(match.body, verbatim, "body was modified");
  });

  test("record multiple kinds and filter by kind", async () => {
    await recordMemory(projectDb, globalDbPath, { kind: "learning", body: "tree-sitter WASM is ~2x slower than native but avoids C++ toolchain issues" });
    await recordMemory(projectDb, globalDbPath, { kind: "todo", body: "Add Python language plugin in Phase 3" });

    const learnings = await recallMemory(projectDb, globalDbPath, { kind: "learning" });
    assert.ok(Array.isArray(learnings) && learnings.every((m) => m.kind === "learning"), "non-learning returned");

    const todos = await recallMemory(projectDb, globalDbPath, { kind: "todo" });
    assert.ok(Array.isArray(todos) && todos.every((m) => m.kind === "todo"), "non-todo returned");
  });

  test("forget (soft delete) sets forgotten_at and hides from recall", async () => {
    const result = await recordMemory(projectDb, globalDbPath, {
      kind: "learning",
      body: "This memory will be forgotten: unique-forgotten-marker-xyz",
    });

    // Soft delete
    projectDb.prepare("UPDATE memory SET forgotten_at = ? WHERE id = ?").run(Date.now(), result.id);

    const matches = await recallMemory(projectDb, globalDbPath, { query: "unique-forgotten-marker-xyz" });
    const match = matches.find((m) => m.id === result.id);
    assert.ok(!match, "forgotten memory should not appear in recall");

    // Row still exists for audit
    const row = projectDb.prepare("SELECT * FROM memory WHERE id = ?").get(result.id);
    assert.ok(row, "row should not be physically deleted");
    assert.ok(row.forgotten_at != null, "forgotten_at should be set");
  });

  test("listMemories returns all non-forgotten records with pagination", async () => {
    // Record several memories
    for (let i = 0; i < 5; i++) {
      await recordMemory(projectDb, globalDbPath, {
        kind: "learning",
        body: `Pagination test memory ${i}`,
      });
    }

    const page1 = await listMemories(projectDb, globalDbPath, { limit: 3, offset: 0 });
    assert.ok(Array.isArray(page1) && page1.length === 3, `expected 3 on page1, got ${page1.length}`);

    const page2 = await listMemories(projectDb, globalDbPath, { limit: 3, offset: 3 });
    assert.ok(Array.isArray(page2) && page2.length > 0, "expected results on page2");

    // No overlap between pages
    const ids1 = new Set(page1.map((m) => m.id));
    const ids2 = new Set(page2.map((m) => m.id));
    for (const id of ids2) {
      assert.ok(!ids1.has(id), `id ${id} appears in both pages`);
    }
  });

  test("malformed JSON in tags column is tolerated", async () => {
    projectDb.prepare(`
      INSERT INTO memory (kind, body, scope, source, tags, created_at)
      VALUES ('learning', 'memory with broken tags column', 'project', 'agent', 'not-json', ?)
    `).run(Date.now());

    const matches = await recallMemory(projectDb, globalDbPath, { query: "broken tags column" });
    const match = matches.find((m) => m.body === "memory with broken tags column");
    assert.ok(match, "row with malformed tags should still be returned");
    assert.equal(match.tags, null, "malformed tags should resolve to null");
  });

  test("FTS5 special characters in query do not throw", async () => {
    await recordMemory(projectDb, globalDbPath, {
      kind: "learning",
      body: "test target token: ftsspecialcase",
    });

    const matches = await recallMemory(projectDb, globalDbPath, {
      query: 'foo\\bar AND "quoted" NEAR ftsspecialcase',
    });
    assert.ok(Array.isArray(matches), "recall should return an array, not throw");
    const match = matches.find((m) => m.body.includes("ftsspecialcase"));
    assert.ok(match, "should match on the sanitized token");
  });

  test("listMemories interleaves project and global scopes by created_at", async () => {
    const now = Date.now();
    await recordMemory(projectDb, globalDbPath, {
      kind: "learning", body: "interleave-project-A", scope: "project",
    });
    await recordMemory(projectDb, globalDbPath, {
      kind: "learning", body: "interleave-global-A", scope: "global",
    });
    await recordMemory(projectDb, globalDbPath, {
      kind: "learning", body: "interleave-project-B", scope: "project",
    });
    await recordMemory(projectDb, globalDbPath, {
      kind: "learning", body: "interleave-global-B", scope: "global",
    });

    const page = await listMemories(projectDb, globalDbPath, { limit: 20, offset: 0 });
    const interleaved = page.filter((m) => m.body?.startsWith("interleave-"));
    const scopes = new Set(interleaved.map((m) => m.scope));
    assert.ok(scopes.has("project"), "expected at least one project entry");
    assert.ok(scopes.has("global"), "expected at least one global entry");
    assert.ok(interleaved.length >= 4, `expected >=4 interleaved entries, got ${interleaved.length}`);
  });

  test("invalid kind throws", async () => {
    await assert.rejects(
      () => recordMemory(projectDb, globalDbPath, { kind: "invalid", body: "test" }),
      /kind must be one of/
    );
  });

  test("empty body throws", async () => {
    await assert.rejects(
      () => recordMemory(projectDb, globalDbPath, { kind: "learning", body: "" }),
      /body must not be empty/
    );
  });
});

describe("gcMemory", () => {
  test("soft-deletes old zero-recall memories", async () => {
    // Insert an old memory with recall_count=0
    projectDb.prepare(`
      INSERT INTO memory (kind, body, scope, source, created_at)
      VALUES ('learning', 'old zero-recall memory for gc test', 'project', 'agent', ?)
    `).run(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago

    const oldId = projectDb.prepare("SELECT id FROM memory WHERE body = 'old zero-recall memory for gc test'").get()?.id;
    assert.ok(oldId, "test row not inserted");

    await gcMemory(projectDb, globalDbPath, { olderThanDays: 30 });

    const row = projectDb.prepare("SELECT * FROM memory WHERE id = ?").get(oldId);
    assert.ok(row.forgotten_at != null, "expected forgotten_at to be set after GC");
  });

  test("does not delete pinned memories", async () => {
    projectDb.prepare(`
      INSERT INTO memory (kind, body, scope, source, tags, created_at)
      VALUES ('learning', 'pinned memory should survive gc', 'project', 'agent', '["pinned"]', ?)
    `).run(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days ago

    const pinnedId = projectDb.prepare("SELECT id FROM memory WHERE body = 'pinned memory should survive gc'").get()?.id;
    assert.ok(pinnedId, "pinned test row not inserted");

    await gcMemory(projectDb, globalDbPath, { olderThanDays: 30 });

    const row = projectDb.prepare("SELECT * FROM memory WHERE id = ?").get(pinnedId);
    assert.ok(row.forgotten_at == null, "pinned memory should not be forgotten");
  });
});
