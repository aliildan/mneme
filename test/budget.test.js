import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packContext } from "../src/retrieval/budget.js";
import { openProjectDb } from "../src/db/open.js";
import { migrateProjectDb } from "../src/db/migrate.js";
import { estimateTokens } from "../src/util/token-estimate.js";

let tmpDir;
let db;

// Each "file" has lines that are 40 chars each => ~10 tokens per line
const LINE = "x".repeat(40); // 10 tokens

function makeSource(lineCount) {
  return Array.from({ length: lineCount }, (_, i) => `${LINE} // ${String(i).padStart(3, "0")}`).join("\n");
}

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-budget-"));
  await mkdir(join(tmpDir, "src"));

  db = await openProjectDb("budget-test", join(tmpDir, "budget.db"));
  migrateProjectDb(db);

  // Create files with known sizes
  const files = [
    { rel: "src/big.ts", lines: 200 },   // ~200*~11 = ~550 tokens
    { rel: "src/small.ts", lines: 20 },  // ~20*~11 = ~55 tokens
    { rel: "src/tiny.ts", lines: 5 },    // ~50 tokens
  ];

  let startByte = 0;
  for (const f of files) {
    const src = makeSource(f.lines);
    await writeFile(join(tmpDir, f.rel), src);

    db.prepare(`
      INSERT INTO files (rel_path, language, size_bytes, mtime_ms, content_hash, parsed_at, parse_ok)
      VALUES (?, 'typescript', ?, ?, ?, ?, 1)
    `).run(f.rel, src.length, Date.now(), "hash-" + f.rel, Date.now());

    const { id: fileId } = db.prepare("SELECT id FROM files WHERE rel_path = ?").get(f.rel);

    // Insert one symbol per file spanning all lines
    db.prepare(`
      INSERT INTO symbols (file_id, name, kind, container, start_line, end_line, start_byte, end_byte, exported, signature, doc)
      VALUES (?, ?, 'function', null, 1, ?, 0, ?, 1, ?, null)
    `).run(fileId, `fn_${f.rel.replace(/[^a-z]/g, "_")}`, f.lines, src.length, `export function fn_${f.rel.replace(/[^a-z]/g, "_")}() {}`);
  }
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("packContext budget enforcement", () => {
  function makeRanked(names) {
    return names.map((name) => {
      const sym = db.prepare("SELECT * FROM symbols WHERE name = ?").get(name);
      if (!sym) throw new Error(`Symbol not found: ${name}`);
      return { id: sym.id, name: sym.name, score: 1.0, reasons: ["test"] };
    });
  }

  test("total token budget is respected", async () => {
    const allSymbols = db.prepare("SELECT * FROM symbols ORDER BY id").all();
    const ranked = allSymbols.map((s) => ({ id: s.id, name: s.name, score: 1.0, reasons: ["test"] }));

    const budget = 200;
    const result = await packContext(ranked, db, tmpDir, budget, 99999);
    assert.ok(
      result.token_estimate <= budget,
      `token_estimate ${result.token_estimate} exceeds budget ${budget}`
    );
  });

  test("per-file cap is respected", async () => {
    // big.ts has ~550+ tokens; cap at 100
    const bigSym = db.prepare("SELECT * FROM symbols WHERE name LIKE 'fn_src_big%'").get();
    assert.ok(bigSym, "big.ts symbol not found");
    const ranked = [{ id: bigSym.id, name: bigSym.name, score: 1.0, reasons: ["test"] }];

    const perFileCap = 100;
    const result = await packContext(ranked, db, tmpDir, 99999, perFileCap);

    // big.ts symbol exceeds per-file cap, should be excluded
    const bigInResult = result.symbols.find((s) => s.name === bigSym.name);
    assert.ok(!bigInResult, "big.ts symbol should be excluded by per-file cap");
  });

  test("small symbols within budget are included", async () => {
    const smallSym = db.prepare("SELECT * FROM symbols WHERE name LIKE 'fn_src_small%'").get();
    const tinySym = db.prepare("SELECT * FROM symbols WHERE name LIKE 'fn_src_tiny%'").get();
    assert.ok(smallSym && tinySym, "test symbols not found");

    const ranked = [
      { id: smallSym.id, name: smallSym.name, score: 1.0, reasons: ["test"] },
      { id: tinySym.id, name: tinySym.name, score: 0.9, reasons: ["test"] },
    ];

    const result = await packContext(ranked, db, tmpDir, 99999, 99999);
    const names = result.symbols.map((s) => s.name);
    assert.ok(names.includes(smallSym.name), "small.ts symbol should be included");
    assert.ok(names.includes(tinySym.name), "tiny.ts symbol should be included");
  });

  test("result includes token_estimate, symbols, and snippets arrays", async () => {
    const sym = db.prepare("SELECT * FROM symbols LIMIT 1").get();
    const ranked = [{ id: sym.id, name: sym.name, score: 1.0, reasons: ["test"] }];
    const result = await packContext(ranked, db, tmpDir, 99999, 99999);

    assert.ok(typeof result.token_estimate === "number");
    assert.ok(Array.isArray(result.symbols));
    assert.ok(Array.isArray(result.snippets));
  });

  test("empty ranked list returns empty result", async () => {
    const result = await packContext([], db, tmpDir, 99999, 99999);
    assert.equal(result.symbols.length, 0);
    assert.equal(result.snippets.length, 0);
    assert.equal(result.token_estimate, 0);
  });
});

describe("estimateTokens", () => {
  test("empty string returns 0", () => {
    assert.equal(estimateTokens(""), 0);
  });

  test("null/undefined returns 0", () => {
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
  });

  test("4-char string returns 1 token", () => {
    assert.equal(estimateTokens("abcd"), 1);
  });

  test("40-char string returns 10 tokens", () => {
    assert.equal(estimateTokens("a".repeat(40)), 10);
  });
});
