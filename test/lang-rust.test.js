import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import rustPlugin from "../src/parser/languages/rust.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "rs-small", "lib.rs");
const GOLDEN_DIR = join(__dirname, "golden");
const GOLDEN = join(GOLDEN_DIR, "rs_small_lib.json");

async function readOrNull(p) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; }
}

describe("Rust symbol extraction — rs-small fixture", () => {
  let result;

  before(async () => {
    const bytes = await readFile(FIXTURE);
    result = await rustPlugin.extractSymbolsAndEdges("lib.rs", bytes);
  });

  test("parse succeeds", () => {
    assert.equal(result.parseOk, true);
    assert.equal(result.parseError, null);
  });

  test("extracts Config struct as class, exported", () => {
    // struct_item matches → kind: "class"; pub prefix → exported: 1
    const structs = result.symbols.filter((s) => s.name === "Config" && s.kind === "class");
    assert.ok(structs.length >= 1, "Config class not found");
    const structDecl = structs.find((s) => s.signature.includes("struct"));
    assert.ok(structDecl, "Config struct declaration not found");
    assert.equal(structDecl.exported, 1);
  });

  test("extracts Status enum, exported", () => {
    const sym = result.symbols.find((s) => s.name === "Status" && s.kind === "enum");
    assert.ok(sym, "Status enum not found");
    assert.equal(sym.exported, 1);
  });

  test("extracts Handler trait as interface, exported", () => {
    const sym = result.symbols.find((s) => s.name === "Handler" && s.kind === "interface");
    assert.ok(sym, "Handler interface not found");
    assert.equal(sym.exported, 1);
  });

  test("extracts new_config function, exported", () => {
    const sym = result.symbols.find((s) => s.name === "new_config" && s.kind === "function");
    assert.ok(sym, "new_config not found");
    assert.equal(sym.exported, 1);
    assert.ok(sym.start_line > 0);
    assert.ok(sym.end_line >= sym.start_line);
  });

  test("extracts impl Config block as class", () => {
    // impl_item matches → kind: "class"; impl keyword itself is not pub → exported: 0
    const implDecl = result.symbols.find((s) => s.name === "Config" && s.signature.includes("impl"));
    assert.ok(implDecl, "Config impl not found");
    assert.equal(implDecl.kind, "class");
    assert.equal(implDecl.exported, 0);
  });

  test("methods inside impl block are also captured as function items", () => {
    // function_item query matches all fn definitions including those in impl blocks
    const addr = result.symbols.find((s) => s.name === "addr" && s.kind === "function");
    assert.ok(addr, "addr function not found");
    assert.equal(addr.exported, 1);
  });

  test("extracts use declarations as import edges", () => {
    const targets = result.edges.map((e) => e.raw_target);
    assert.ok(targets.includes("std::collections::HashMap"), "HashMap use edge missing");
    assert.ok(targets.includes("std::fmt"), "std::fmt use edge missing");
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
