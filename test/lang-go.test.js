import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import goPlugin from "../src/parser/languages/go.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "go-small", "server.go");
const GOLDEN_DIR = join(__dirname, "golden");
const GOLDEN = join(GOLDEN_DIR, "go_small_server.json");

async function readOrNull(p) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; }
}

describe("Go symbol extraction — go-small fixture", () => {
  let result;

  before(async () => {
    const bytes = await readFile(FIXTURE);
    result = await goPlugin.extractSymbolsAndEdges("server.go", bytes);
  });

  test("parse succeeds", () => {
    assert.equal(result.parseOk, true);
    assert.equal(result.parseError, null);
  });

  test("extracts Config struct as type_alias", () => {
    const sym = result.symbols.find((s) => s.name === "Config");
    assert.ok(sym, "Config not found");
    assert.equal(sym.kind, "type_alias");
    assert.equal(sym.exported, 1);
  });

  test("extracts Handler interface as type_alias", () => {
    const sym = result.symbols.find((s) => s.name === "Handler");
    assert.ok(sym, "Handler not found");
    assert.equal(sym.kind, "type_alias");
    assert.equal(sym.exported, 1);
  });

  test("extracts NewConfig as exported function", () => {
    const sym = result.symbols.find((s) => s.name === "NewConfig");
    assert.ok(sym, "NewConfig not found");
    assert.equal(sym.kind, "function");
    assert.equal(sym.exported, 1);
    assert.ok(sym.start_line > 0);
    assert.ok(sym.end_line >= sym.start_line);
  });

  test("extracts Addr as method", () => {
    const sym = result.symbols.find((s) => s.name === "Addr");
    assert.ok(sym, "Addr not found");
    assert.equal(sym.kind, "method");
    assert.equal(sym.exported, 1);
  });

  test("extracts import edges for fmt and net/http (grouped import block)", () => {
    const targets = result.edges.map((e) => e.raw_target);
    assert.ok(targets.includes("fmt"), "fmt import edge missing");
    assert.ok(targets.includes("net/http"), "net/http import edge missing");
    assert.ok(result.edges.every((e) => e.kind === "imports"));
  });

  test("golden snapshot matches", async () => {
    const existing = await readOrNull(GOLDEN);
    if (existing === null) {
      await mkdir(GOLDEN_DIR, { recursive: true });
      await writeFile(GOLDEN, JSON.stringify(result, null, 2) + "\n");
      return;
    }
    assert.deepEqual(
      result.symbols.map((s) => s.name),
      existing.symbols.map((s) => s.name),
    );
    assert.equal(result.symbols.length, existing.symbols.length);
  });
});
