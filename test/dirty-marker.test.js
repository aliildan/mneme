import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDb } from "../src/db/open.js";
import { migrateProjectDb } from "../src/db/migrate.js";
import { ensureFresh } from "../src/index/validator.js";

let projectRoot;
let dbDir;
let dbPath;
let db;

before(async () => {
  const base = await mkdtemp(join(tmpdir(), "mneme-dirty-"));
  projectRoot = join(base, "project");
  dbDir = join(base, "db");
  await mkdir(projectRoot);
  await mkdir(dbDir);
  await mkdir(join(projectRoot, "src"));
  await writeFile(join(projectRoot, "src", "a.ts"), "export const a = 1;");
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "dirty-test" }));

  dbPath = join(dbDir, "dirty.db");
  db = await openProjectDb("dirty-test-hash", dbPath);
  migrateProjectDb(db);
});

after(async () => {
  await rm(join(projectRoot, ".."), { recursive: true, force: true });
});

describe("ensureFresh dirty marker", () => {
  test(".dirty marker bypasses debounce and is consumed", async () => {
    // Initial validation populates the index and the debounce cache
    const first = await ensureFresh(db, projectRoot, {});
    assert.equal(first.changed, true, "first call should index everything");

    // Immediate second call should be debounced
    const debounced = await ensureFresh(db, projectRoot, {});
    assert.equal(debounced.skipped, true, "expected debounced skip, got: " + JSON.stringify(debounced));

    // Drop a .dirty marker next to the DB
    const dirtyPath = join(dbDir, ".dirty");
    await writeFile(dirtyPath, String(Date.now()));

    // Should bypass the debounce
    const forced = await ensureFresh(db, projectRoot, {});
    assert.ok(forced.skipped !== true, `expected force-fresh, got: ${JSON.stringify(forced)}`);

    // Marker should be gone
    let dirtyStillExists = true;
    try { await access(dirtyPath); } catch { dirtyStillExists = false; }
    assert.equal(dirtyStillExists, false, ".dirty marker should be consumed");
  });
});
