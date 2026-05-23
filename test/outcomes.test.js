import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDb } from "../src/db/open.js";
import { migrateProjectDb } from "../src/db/migrate.js";

let tmpDir;
let db;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-outcomes-"));
  db = await openProjectDb("outcomes-test", join(tmpDir, "outcomes.db"));
  migrateProjectDb(db);
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("retrieval_outcomes table", () => {
  test("can insert and retrieve an outcome record", () => {
    const symbols = JSON.stringify([{ name: "login", file: "src/auth.ts" }]);
    db.prepare(`
      INSERT INTO retrieval_outcomes (context_id, task, hint, symbols, outcome, tokens_in, tokens_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("ctx-001", "authenticate user", "src/auth.ts", symbols, "success", 1200, 800, Date.now());

    const row = db.prepare("SELECT * FROM retrieval_outcomes WHERE task = 'authenticate user'").get();
    assert.ok(row, "outcome not found");
    assert.equal(row.outcome, "success");
    assert.equal(row.tokens_in, 1200);
    assert.equal(row.tokens_used, 800);
  });

  test("all outcome values are valid", () => {
    const now = Date.now();
    for (const outcome of ["success", "failure", "partial"]) {
      db.prepare(`
        INSERT INTO retrieval_outcomes (context_id, task, symbols, outcome, created_at)
        VALUES (?, ?, '[]', ?, ?)
      `).run(`ctx-${outcome}`, `test-${outcome}`, outcome, now);
    }

    const rows = db.prepare("SELECT outcome FROM retrieval_outcomes WHERE task LIKE 'test-%'").all();
    const outcomes = rows.map((r) => r.outcome);
    assert.ok(outcomes.includes("success"));
    assert.ok(outcomes.includes("failure"));
    assert.ok(outcomes.includes("partial"));
  });

  test("can aggregate outcomes by type", () => {
    const now = Date.now();
    db.prepare("DELETE FROM retrieval_outcomes").run();

    const data = [
      { task: "t1", outcome: "success", tokensIn: 1000, tokensUsed: 500 },
      { task: "t2", outcome: "success", tokensIn: 2000, tokensUsed: 900 },
      { task: "t3", outcome: "failure", tokensIn: 800, tokensUsed: 600 },
      { task: "t4", outcome: "partial", tokensIn: 1500, tokensUsed: 700 },
    ];

    for (const d of data) {
      db.prepare(`
        INSERT INTO retrieval_outcomes (context_id, task, symbols, outcome, tokens_in, tokens_used, created_at)
        VALUES (?, ?, '[]', ?, ?, ?, ?)
      `).run(`ctx-agg-${d.task}`, d.task, d.outcome, d.tokensIn, d.tokensUsed, now);
    }

    const stats = db.prepare(`
      SELECT outcome, COUNT(*) as count, AVG(tokens_used) as avg_tokens
      FROM retrieval_outcomes
      GROUP BY outcome
    `).all();

    const successStat = stats.find((s) => s.outcome === "success");
    assert.ok(successStat, "no success stat");
    assert.equal(successStat.count, 2);
    assert.equal(successStat.avg_tokens, 700); // (500 + 900) / 2
  });

  test("memory recall_count increments", () => {
    db.prepare(`
      INSERT INTO memory (kind, body, scope, source, created_at, recall_count)
      VALUES ('learning', 'outcome test memory', 'project', 'agent', ?, 0)
    `).run(Date.now());

    const id = db.prepare("SELECT id FROM memory WHERE body = 'outcome test memory'").get().id;

    db.prepare("UPDATE memory SET recall_count = recall_count + 1, last_recalled_at = ? WHERE id = ?")
      .run(Date.now(), id);

    const row = db.prepare("SELECT recall_count, last_recalled_at FROM memory WHERE id = ?").get(id);
    assert.equal(row.recall_count, 1);
    assert.ok(row.last_recalled_at > 0);
  });
});
