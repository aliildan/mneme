import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDb } from "../src/db/open.js";
import { migrateProjectDb } from "../src/db/migrate.js";
import { ensureFresh } from "../src/index/validator.js";

let projectRoot;
let dbDir;
let db;

before(async () => {
  const base = await mkdtemp(join(tmpdir(), "mneme-gitignore-"));
  projectRoot = join(base, "project");
  dbDir = join(base, "db");
  await mkdir(projectRoot);
  await mkdir(dbDir);
  await mkdir(join(projectRoot, "src"));

  await writeFile(join(projectRoot, "src", "keep.ts"), "export function keepMe() { return 1; }");
  await writeFile(join(projectRoot, "src", "skip.ts"), "export function skipMe() { return 2; }");
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "gi-test" }));
  await writeFile(join(projectRoot, ".gitignore"), "src/skip.ts\n");

  db = await openProjectDb("gi-test-hash", join(dbDir, "gi.db"));
  migrateProjectDb(db);
});

after(async () => {
  await rm(join(projectRoot, ".."), { recursive: true, force: true });
});

describe(".gitignore respect", () => {
  test("file listed in .gitignore is not indexed", async () => {
    await ensureFresh(db, projectRoot, {});

    const files = db.prepare("SELECT rel_path FROM files").all().map((r) => r.rel_path);
    assert.ok(files.includes("src/keep.ts"), `expected src/keep.ts in index, got: ${JSON.stringify(files)}`);
    assert.ok(!files.includes("src/skip.ts"), `src/skip.ts should be excluded by .gitignore`);

    const skipSym = db.prepare("SELECT id FROM symbols WHERE name = 'skipMe'").get();
    assert.ok(!skipSym, "skipMe symbol should not be in index");

    const keepSym = db.prepare("SELECT id FROM symbols WHERE name = 'keepMe'").get();
    assert.ok(keepSym, "keepMe symbol should be in index");
  });
});
