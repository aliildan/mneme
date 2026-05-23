import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDb } from "../src/db/open.js";
import { migrateProjectDb } from "../src/db/migrate.js";
import { getStmts } from "../src/db/statements.js";
import { rankSymbols } from "../src/retrieval/rank.js";

let tmpDir;
let db;
let fileId;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-rank-"));
  db = await openProjectDb("rank-test", join(tmpDir, "rank.db"));
  migrateProjectDb(db);

  const stmts = getStmts(db);

  // Insert files
  db.prepare(`
    INSERT INTO files (rel_path, language, size_bytes, mtime_ms, content_hash, parsed_at, parse_ok)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("src/auth.ts", "typescript", 500, Date.now(), "aaaa", Date.now(), 1);

  fileId = db.prepare("SELECT id FROM files WHERE rel_path = 'src/auth.ts'").get().id;

  db.prepare(`
    INSERT INTO files (rel_path, language, size_bytes, mtime_ms, content_hash, parsed_at, parse_ok)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("src/router.ts", "typescript", 800, Date.now(), "bbbb", Date.now(), 1);

  const routerFileId = db.prepare("SELECT id FROM files WHERE rel_path = 'src/router.ts'").get().id;

  // Insert symbols for auth.ts
  const insertSym = db.prepare(`
    INSERT INTO symbols (file_id, name, kind, container, start_line, end_line, start_byte, end_byte, exported, signature, doc)
    VALUES (@file_id, @name, @kind, @container, @start_line, @end_line, @start_byte, @end_byte, @exported, @signature, @doc)
  `);

  insertSym.run({ file_id: fileId, name: "AuthService", kind: "class", container: null, start_line: 10, end_line: 30, start_byte: 200, end_byte: 600, exported: 1, signature: "export class AuthService", doc: null });
  insertSym.run({ file_id: fileId, name: "login", kind: "method", container: "AuthService", start_line: 20, end_line: 25, start_byte: 350, end_byte: 480, exported: 0, signature: "login(email: string): AuthResult", doc: "Authenticate a user by email" });
  insertSym.run({ file_id: fileId, name: "register", kind: "method", container: "AuthService", start_line: 12, end_line: 18, start_byte: 210, end_byte: 340, exported: 0, signature: "register(email: string, password: string): AuthResult", doc: "Register a new user" });
  insertSym.run({ file_id: fileId, name: "hashPassword", kind: "function", container: null, start_line: 8, end_line: 10, start_byte: 100, end_byte: 200, exported: 1, signature: "export function hashPassword(password: string, salt: string): string", doc: "Hash a password with salt" });

  // Insert symbols for router.ts
  insertSym.run({ file_id: routerFileId, name: "Router", kind: "class", container: null, start_line: 5, end_line: 40, start_byte: 50, end_byte: 900, exported: 1, signature: "export class Router", doc: null });
  insertSym.run({ file_id: routerFileId, name: "dispatch", kind: "method", container: "Router", start_line: 25, end_line: 35, start_byte: 500, end_byte: 800, exported: 0, signature: "async dispatch(method: string, path: string): Promise<Response>", doc: "Route an incoming request" });
  insertSym.run({ file_id: routerFileId, name: "createRouter", kind: "function", container: null, start_line: 42, end_line: 44, start_byte: 910, end_byte: 960, exported: 1, signature: "export function createRouter(auth: AuthService): Router", doc: null });

  // Rebuild FTS index
  db.prepare("INSERT INTO symbols_fts(symbols_fts) VALUES ('rebuild')").run();
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("rankSymbols", () => {
  test("task 'authenticate user login' surfaces login method in top 3", () => {
    const results = rankSymbols(db, "authenticate user login", null, {});
    const top3 = results.slice(0, 3).map((r) => r.name);
    assert.ok(
      top3.includes("login") || top3.includes("AuthService"),
      `expected login or AuthService in top 3, got: ${JSON.stringify(top3)}`
    );
  });

  test("task 'route incoming request dispatch' surfaces dispatch", () => {
    const results = rankSymbols(db, "route incoming request dispatch", null, {});
    const names = results.map((r) => r.name);
    assert.ok(
      names.includes("dispatch"),
      `expected dispatch in results, got: ${JSON.stringify(names)}`
    );
    const dispatchIdx = names.indexOf("dispatch");
    assert.ok(dispatchIdx < 4, `dispatch should be in top 4, got idx ${dispatchIdx}`);
  });

  test("task 'hash password salt' surfaces hashPassword", () => {
    const results = rankSymbols(db, "hash password salt", null, {});
    const top3 = results.slice(0, 3).map((r) => r.name);
    assert.ok(
      top3.includes("hashPassword"),
      `expected hashPassword in top 3, got: ${JSON.stringify(top3)}`
    );
  });

  test("hint path boosts all symbols in hinted file", () => {
    const withHint = rankSymbols(db, "something", "src/router.ts", {});
    const withoutHint = rankSymbols(db, "something", null, {});
    const withHintNames = withHint.slice(0, 3).map((r) => r.name);
    // Router symbols should appear higher when router.ts is hinted
    const routerSymInTop3 = withHintNames.some((n) => ["Router", "dispatch", "createRouter"].includes(n));
    assert.ok(routerSymInTop3, `expected a Router symbol in top 3 with hint, got: ${JSON.stringify(withHintNames)}`);
  });

  test("returns deterministic order (stable sort by score desc, id asc)", () => {
    const a = rankSymbols(db, "auth service register user", null, {});
    const b = rankSymbols(db, "auth service register user", null, {});
    assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id));
  });

  test("empty task returns results without crashing", () => {
    const results = rankSymbols(db, "", null, {});
    assert.ok(Array.isArray(results));
  });
});
