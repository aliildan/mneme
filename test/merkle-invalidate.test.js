import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, utimes, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLazily, persistMerkle } from "../src/fs/merkle.js";
import { openProjectDb } from "../src/db/open.js";
import { migrateProjectDb } from "../src/db/migrate.js";

let projectRoot;  // the "project" directory that gets indexed
let dbDir;        // separate dir for the DB (not inside projectRoot)
let db;

async function setup() {
  // Use two separate temp dirs so the DB files don't appear in the project root
  const base = await mkdtemp(join(tmpdir(), "mneme-merkle-"));
  projectRoot = join(base, "project");
  dbDir = join(base, "db");
  await mkdir(projectRoot);
  await mkdir(dbDir);
  await mkdir(join(projectRoot, "src"));
  await writeFile(join(projectRoot, "src", "a.ts"), "export const a = 1;");
  await writeFile(join(projectRoot, "src", "b.ts"), "export const b = 2;");
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "test" }));

  db = await openProjectDb("test-hash", join(dbDir, "test.db"));
  migrateProjectDb(db);
}

async function teardown() {
  const base = join(projectRoot, "..");
  await rm(base, { recursive: true, force: true });
}

async function buildInitial() {
  const result = await validateLazily(db, projectRoot, {});
  persistMerkle(db, result.newHashes, [], Date.now());
  db.prepare("UPDATE meta SET value = ? WHERE key = 'merkle_root'").run(result.newRootHash);
  return result;
}

describe("Merkle invalidation", () => {
  beforeEach(setup);
  afterEach(teardown);

  test("first walk marks all files dirty (no existing hashes)", async () => {
    const result = await validateLazily(db, projectRoot, {});
    assert.ok(result.dirty.size > 0, "expected dirty files on first walk");
    assert.equal(result.removed.size, 0);
  });

  test("second walk with no changes: dirty=empty, removed=empty", async () => {
    await buildInitial();

    const result = await validateLazily(db, projectRoot, {});
    assert.equal(result.dirty.size, 0, `expected 0 dirty, got ${result.dirty.size}: ${JSON.stringify([...result.dirty])}`);
    assert.equal(result.removed.size, 0);
  });

  test("mutating one file marks exactly that file dirty", async () => {
    await buildInitial();

    // Wait a tick to ensure mtime will differ
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(projectRoot, "src", "a.ts"), "export const a = 99; // changed");

    const result = await validateLazily(db, projectRoot, {});
    const dirtyPaths = [...result.dirty];
    assert.ok(
      dirtyPaths.some((p) => p.endsWith("a.ts")),
      `expected a.ts in dirty, got: ${JSON.stringify(dirtyPaths)}`
    );
    assert.ok(
      !dirtyPaths.some((p) => p.endsWith("b.ts")),
      "b.ts should not be dirty"
    );
  });

  test("touching mtime only (same content) keeps file clean", async () => {
    await buildInitial();

    const aPath = join(projectRoot, "src", "a.ts");
    const future = new Date(Date.now() + 10000);
    await utimes(aPath, future, future);

    const result = await validateLazily(db, projectRoot, {});
    const dirtyPaths = [...result.dirty];
    // mtime changed but content hash matches → not dirty
    assert.ok(
      !dirtyPaths.some((p) => p.endsWith("a.ts")),
      `a.ts should not be dirty after mtime-only touch, got: ${JSON.stringify(dirtyPaths)}`
    );
  });

  test("deleted file appears in removed", async () => {
    await buildInitial();

    await rm(join(projectRoot, "src", "b.ts"));

    const result = await validateLazily(db, projectRoot, {});
    const removedPaths = [...result.removed];
    assert.ok(
      removedPaths.some((p) => p.endsWith("b.ts")),
      `expected b.ts in removed, got: ${JSON.stringify(removedPaths)}`
    );
  });

  test("adding a new file marks it dirty", async () => {
    await buildInitial();

    await writeFile(join(projectRoot, "src", "c.ts"), "export const c = 3;");

    const result = await validateLazily(db, projectRoot, {});
    const dirtyPaths = [...result.dirty];
    assert.ok(
      dirtyPaths.some((p) => p.endsWith("c.ts")),
      `expected c.ts in dirty, got: ${JSON.stringify(dirtyPaths)}`
    );
  });

  test("root hash changes when content changes", async () => {
    const first = await buildInitial();
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(projectRoot, "src", "a.ts"), "export const a = 999;");
    const second = await validateLazily(db, projectRoot, {});
    assert.notEqual(first.newRootHash, second.newRootHash);
  });

  test("root hash stable when nothing changes", async () => {
    const first = await buildInitial();
    const second = await validateLazily(db, projectRoot, {});
    assert.equal(first.newRootHash, second.newRootHash);
  });
});
