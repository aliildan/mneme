import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDb } from "../src/db/open.js";
import { migrateProjectDb } from "../src/db/migrate.js";
import { queryGraph } from "../src/graph/queries.js";

let tmpDir;
let db;

//  Call graph: index -> router -> auth
//  index calls handleRequest
//  handleRequest calls loginHandler
//  loginHandler calls authenticate
//  authenticate is a leaf

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-graph-"));
  db = await openProjectDb("graph-test", join(tmpDir, "graph.db"));
  migrateProjectDb(db);

  const files = [
    { rel: "src/index.ts" },
    { rel: "src/router.ts" },
    { rel: "src/auth.ts" },
  ];

  for (const f of files) {
    db.prepare(`
      INSERT INTO files (rel_path, language, size_bytes, mtime_ms, content_hash, parsed_at, parse_ok)
      VALUES (?, 'typescript', 100, ?, ?, ?, 1)
    `).run(f.rel, Date.now(), `hash-${f.rel}`, Date.now());
  }

  const indexFileId = db.prepare("SELECT id FROM files WHERE rel_path = 'src/index.ts'").get().id;
  const routerFileId = db.prepare("SELECT id FROM files WHERE rel_path = 'src/router.ts'").get().id;
  const authFileId = db.prepare("SELECT id FROM files WHERE rel_path = 'src/auth.ts'").get().id;

  const insertSym = db.prepare(`
    INSERT INTO symbols (file_id, name, kind, start_line, end_line, start_byte, end_byte, exported, signature)
    VALUES (@fid, @name, @kind, 1, 10, 0, 100, @exp, @sig)
  `);

  insertSym.run({ fid: indexFileId, name: "handleRequest", kind: "function", exp: 1, sig: "function handleRequest()" });
  insertSym.run({ fid: routerFileId, name: "loginHandler", kind: "function", exp: 0, sig: "function loginHandler()" });
  insertSym.run({ fid: authFileId, name: "authenticate", kind: "function", exp: 1, sig: "function authenticate()" });
  insertSym.run({ fid: authFileId, name: "AuthService", kind: "class", exp: 1, sig: "class AuthService" });

  const handleId = db.prepare("SELECT id FROM symbols WHERE name = 'handleRequest'").get().id;
  const loginId = db.prepare("SELECT id FROM symbols WHERE name = 'loginHandler'").get().id;
  const authId = db.prepare("SELECT id FROM symbols WHERE name = 'authenticate'").get().id;

  const insertEdge = db.prepare(`
    INSERT INTO edges (src_file, src_sym, dst_name, dst_file, dst_sym, kind, raw_target)
    VALUES (@sf, @ss, @dn, @df, @ds, @kind, @raw)
  `);

  // handleRequest -> loginHandler (calls)
  insertEdge.run({ sf: indexFileId, ss: handleId, dn: "loginHandler", df: routerFileId, ds: loginId, kind: "calls", raw: "loginHandler" });
  // loginHandler -> authenticate (calls)
  insertEdge.run({ sf: routerFileId, ss: loginId, dn: "authenticate", df: authFileId, ds: authId, kind: "calls", raw: "authenticate" });
  // index.ts imports auth.ts
  insertEdge.run({ sf: indexFileId, ss: null, dn: "AuthService", df: authFileId, ds: null, kind: "imports", raw: "./auth.js" });
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("queryGraph — callers", () => {
  test("1-hop: authenticate is called by loginHandler", () => {
    const result = queryGraph(db, "authenticate", "src/auth.ts", 1, "callers");
    const names = result.map((r) => r.name);
    assert.ok(names.includes("loginHandler"), `expected loginHandler, got: ${JSON.stringify(names)}`);
  });

  test("2-hop: authenticate callers include handleRequest (via loginHandler)", () => {
    const result = queryGraph(db, "authenticate", "src/auth.ts", 2, "callers");
    const names = result.map((r) => r.name);
    assert.ok(names.includes("handleRequest"), `expected handleRequest in 2-hop callers, got: ${JSON.stringify(names)}`);
    assert.ok(names.includes("loginHandler"), "loginHandler should also appear");
  });

  test("1-hop callee: handleRequest calls loginHandler", () => {
    const result = queryGraph(db, "handleRequest", "src/index.ts", 1, "callees");
    const names = result.map((r) => r.name);
    assert.ok(names.includes("loginHandler"), `expected loginHandler in callees, got: ${JSON.stringify(names)}`);
  });

  test("2-hop callees: handleRequest -> loginHandler -> authenticate", () => {
    const result = queryGraph(db, "handleRequest", "src/index.ts", 2, "callees");
    const names = result.map((r) => r.name);
    assert.ok(names.includes("authenticate"), `expected authenticate in 2-hop callees, got: ${JSON.stringify(names)}`);
  });

  test("unknown symbol returns empty array", () => {
    const result = queryGraph(db, "nonExistentSymbol", "src/nowhere.ts", 3, "callers");
    assert.equal(result.length, 0);
  });

  test("result contains path information", () => {
    const result = queryGraph(db, "authenticate", "src/auth.ts", 2, "callers");
    const handleResult = result.find((r) => r.name === "handleRequest");
    assert.ok(handleResult, "handleRequest not in results");
    assert.ok(handleResult.path, "path field missing");
    assert.ok(handleResult.path.length > 0, "path should not be empty");
  });
});

describe("queryGraph — error surfacing", () => {
  test("CTE failure throws with context instead of returning []", async () => {
    const localTmp = await mkdtemp(join(tmpdir(), "mneme-graph-err-"));
    const localDb = await openProjectDb("graph-err-test", join(localTmp, "graph-err.db"));
    migrateProjectDb(localDb);

    localDb.prepare(`
      INSERT INTO files (rel_path, language, size_bytes, mtime_ms, content_hash, parsed_at, parse_ok)
      VALUES ('src/a.ts', 'typescript', 100, ?, 'h', ?, 1)
    `).run(Date.now(), Date.now());

    const fileId = localDb.prepare("SELECT id FROM files WHERE rel_path = 'src/a.ts'").get().id;
    localDb.prepare(`
      INSERT INTO symbols (file_id, name, kind, start_line, end_line, start_byte, end_byte, exported)
      VALUES (?, 'targetSym', 'function', 1, 10, 0, 100, 1)
    `).run(fileId);

    // Drop the edges table — initial symbol lookup still succeeds, but the
    // recursive CTE references `edges` and will fail.
    localDb.exec("DROP TABLE edges");

    assert.throws(
      () => queryGraph(localDb, "targetSym", "src/a.ts", 2, "callers"),
      /graph query failed/,
    );

    await rm(localTmp, { recursive: true, force: true });
  });
});
