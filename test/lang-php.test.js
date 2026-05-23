import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import phpPlugin from "../src/parser/languages/php.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "php-small", "auth.php");
const GOLDEN_DIR = join(__dirname, "golden");
const GOLDEN = join(GOLDEN_DIR, "php_small_auth.json");

async function readOrNull(p) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; }
}

describe("PHP symbol extraction — php-small fixture", () => {
  let result;

  before(async () => {
    const bytes = await readFile(FIXTURE);
    result = await phpPlugin.extractSymbolsAndEdges("auth.php", bytes);
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

  test("extracts AuthInterface as interface", () => {
    const sym = result.symbols.find((s) => s.name === "AuthInterface");
    assert.ok(sym, "AuthInterface not found");
    assert.equal(sym.kind, "interface");
    assert.equal(sym.exported, 1);
  });

  test("extracts AuthService as class", () => {
    const sym = result.symbols.find((s) => s.name === "AuthService");
    assert.ok(sym, "AuthService not found");
    assert.equal(sym.kind, "class");
    assert.equal(sym.exported, 1);
  });

  test("extracts HashHelper trait as class", () => {
    const sym = result.symbols.find((s) => s.name === "HashHelper");
    assert.ok(sym, "HashHelper not found");
    assert.equal(sym.kind, "class");
    assert.equal(sym.exported, 1);
  });

  test("public method login exported=1, private method validate exported=0", () => {
    const login = result.symbols.find((s) => s.name === "login" && s.kind === "method");
    const validate = result.symbols.find((s) => s.name === "validate" && s.kind === "method");
    assert.ok(login, "login method not found");
    assert.ok(validate, "validate method not found");
    assert.equal(login.exported, 1);
    assert.equal(validate.exported, 0);
  });

  test("extracts use declarations as import edges", () => {
    const targets = result.edges.map((e) => e.raw_target);
    assert.ok(targets.includes("App\\Models\\User"), "User use edge missing");
    assert.ok(targets.includes("App\\Helpers\\Hasher"), "Hasher use edge missing");
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
