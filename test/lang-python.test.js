import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pythonPlugin from "../src/parser/languages/python.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "py-small", "auth.py");
const GOLDEN_DIR = join(__dirname, "golden");
const GOLDEN = join(GOLDEN_DIR, "py_small_auth.json");

async function readOrNull(p) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; }
}

describe("Python symbol extraction — py-small fixture", () => {
  let result;

  before(async () => {
    const bytes = await readFile(FIXTURE);
    result = await pythonPlugin.extractSymbolsAndEdges("auth.py", bytes);
  });

  test("parse succeeds", () => {
    assert.equal(result.parseOk, true);
    assert.equal(result.parseError, null);
  });

  test("extracts top-level function hash_password", () => {
    const sym = result.symbols.find((s) => s.name === "hash_password");
    assert.ok(sym, "hash_password not found");
    assert.equal(sym.kind, "function");
    assert.equal(sym.exported, 1);
    assert.ok(sym.signature.includes("hash_password"));
  });

  test("extracts AuthService class", () => {
    const sym = result.symbols.find((s) => s.name === "AuthService");
    assert.ok(sym, "AuthService not found");
    assert.equal(sym.kind, "class");
    assert.equal(sym.exported, 1);
  });

  test("extracts methods inside AuthService with container set", () => {
    const register = result.symbols.find((s) => s.name === "register");
    const login = result.symbols.find((s) => s.name === "login");
    assert.ok(register, "register not found");
    assert.ok(login, "login not found");
    assert.equal(register.kind, "function");
    assert.equal(login.kind, "function");
    assert.equal(register.container, "AuthService");
    assert.equal(login.container, "AuthService");
  });

  test("top-level functions have null container", () => {
    const hp = result.symbols.find((s) => s.name === "hash_password");
    const cached = result.symbols.find((s) => s.name === "cached");
    assert.equal(hp.container, null);
    assert.equal(cached.container, null);
  });

  test("extracts decorated function get_user — produces two entries", () => {
    // Both the decorated_definition node and the inner function_definition are
    // captured by the query, so the same name appears twice.
    const entries = result.symbols.filter((s) => s.name === "get_user");
    assert.equal(entries.length, 2, "expected 2 entries for decorated function");
    assert.ok(entries.every((s) => s.kind === "function"));
  });

  test("extracts import edges for hashlib and typing", () => {
    const targets = result.edges.map((e) => e.raw_target);
    assert.ok(targets.includes("hashlib"), "hashlib import edge missing");
    assert.ok(targets.includes("typing"), "typing import edge missing");
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
