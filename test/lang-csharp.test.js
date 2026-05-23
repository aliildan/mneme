import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import csharpPlugin from "../src/parser/languages/csharp.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "cs-small", "AuthService.cs");
const GOLDEN_DIR = join(__dirname, "golden");
const GOLDEN = join(GOLDEN_DIR, "cs_small_authservice.json");

async function readOrNull(p) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; }
}

describe("C# symbol extraction — cs-small fixture", () => {
  let result;

  before(async () => {
    const bytes = await readFile(FIXTURE);
    result = await csharpPlugin.extractSymbolsAndEdges("AuthService.cs", bytes);
  });

  test("parse succeeds", () => {
    assert.equal(result.parseOk, true);
    assert.equal(result.parseError, null);
  });

  test("extracts IAuthService as interface, exported", () => {
    const sym = result.symbols.find((s) => s.name === "IAuthService");
    assert.ok(sym, "IAuthService not found");
    assert.equal(sym.kind, "interface");
    assert.equal(sym.exported, 1);
  });

  test("extracts AuthService as class, exported", () => {
    const sym = result.symbols.find((s) => s.name === "AuthService");
    assert.ok(sym, "AuthService not found");
    assert.equal(sym.kind, "class");
    assert.equal(sym.exported, 1);
  });

  test("extracts Helpers static class, exported", () => {
    const sym = result.symbols.find((s) => s.name === "Helpers");
    assert.ok(sym, "Helpers not found");
    assert.equal(sym.kind, "class");
    assert.equal(sym.exported, 1);
  });

  test("extracts User record as class, exported", () => {
    const sym = result.symbols.find((s) => s.name === "User");
    assert.ok(sym, "User record not found");
    assert.equal(sym.kind, "class");
    assert.equal(sym.exported, 1);
  });

  test("extracts AuditEntry struct as class, internal → not exported", () => {
    const sym = result.symbols.find((s) => s.name === "AuditEntry");
    assert.ok(sym, "AuditEntry not found");
    assert.equal(sym.kind, "class");
    assert.equal(sym.exported, 0);
  });

  test("extracts Status enum, exported", () => {
    const sym = result.symbols.find((s) => s.name === "Status");
    assert.ok(sym, "Status enum not found");
    assert.equal(sym.kind, "enum");
    assert.equal(sym.exported, 1);
  });

  test("extracts LoginAsync method, exported (public)", () => {
    const sym = result.symbols.find((s) => s.name === "LoginAsync" && s.kind === "method");
    assert.ok(sym, "LoginAsync method not found");
    assert.equal(sym.exported, 1);
  });

  test("extracts Validate method, not exported (private)", () => {
    const sym = result.symbols.find((s) => s.name === "Validate" && s.kind === "method");
    assert.ok(sym, "Validate method not found");
    assert.equal(sym.exported, 0);
  });

  test("extracts using directives as import edges", () => {
    const targets = result.edges.map((e) => e.raw_target);
    assert.ok(targets.includes("System"), "System using edge missing");
    assert.ok(targets.includes("System.Collections.Generic"), "System.Collections.Generic edge missing");
    assert.ok(targets.includes("System.Threading.Tasks"), "System.Threading.Tasks edge missing");
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
