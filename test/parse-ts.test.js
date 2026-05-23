import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractSymbolsAndEdges } from "../src/parser/ts-extract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures", "ts-small", "src");
const GOLDEN_DIR = join(__dirname, "golden");

async function loadFixture(name) {
  const absPath = join(FIXTURES, name);
  const bytes = await readFile(absPath);
  return { bytes, relPath: `src/${name}` };
}

async function goldenPath(name) {
  return join(GOLDEN_DIR, `${name}.json`);
}

async function readOrNull(p) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; }
}

async function checkGolden(fixtureName, actual) {
  const gPath = await goldenPath(fixtureName.replace(/\./g, "_"));
  const existing = await readOrNull(gPath);
  if (existing === null) {
    await mkdir(GOLDEN_DIR, { recursive: true });
    await writeFile(gPath, JSON.stringify(actual, null, 2) + "\n");
    return { wrote: true };
  }
  return { wrote: false, existing };
}

describe("TypeScript symbol extraction — ts-small fixture", () => {
  describe("auth.ts", () => {
    let result;

    before(async () => {
      const { bytes, relPath } = await loadFixture("auth.ts");
      result = await extractSymbolsAndEdges(relPath, bytes, "typescript");
    });

    test("extracts User interface", () => {
      const sym = result.symbols.find((s) => s.name === "User");
      assert.ok(sym, "User not found");
      assert.equal(sym.kind, "interface");
      assert.equal(sym.exported, 1);
    });

    test("extracts AuthResult type alias", () => {
      const sym = result.symbols.find((s) => s.name === "AuthResult");
      assert.ok(sym, "AuthResult not found");
      assert.equal(sym.kind, "type");
      assert.equal(sym.exported, 1);
    });

    test("extracts hashPassword function", () => {
      const sym = result.symbols.find((s) => s.name === "hashPassword");
      assert.ok(sym, "hashPassword not found");
      assert.equal(sym.kind, "function");
      assert.equal(sym.exported, 1);
      assert.ok(sym.start_line > 0);
      assert.ok(sym.end_line >= sym.start_line);
    });

    test("extracts AuthService class", () => {
      const sym = result.symbols.find((s) => s.name === "AuthService");
      assert.ok(sym, "AuthService not found");
      assert.equal(sym.kind, "class");
      assert.equal(sym.exported, 1);
    });

    test("extracts AuthService methods", () => {
      const register = result.symbols.find((s) => s.name === "register");
      const login = result.symbols.find((s) => s.name === "login");
      assert.ok(register, "register method not found");
      assert.ok(login, "login method not found");
      assert.equal(register.kind, "method");
      assert.equal(login.kind, "method");
      assert.equal(register.container, "AuthService");
      assert.equal(login.container, "AuthService");
    });

    test("extracts import edge for node:crypto", () => {
      const edge = result.edges.find((e) => e.raw_target === "node:crypto");
      assert.ok(edge, "node:crypto import edge not found");
      assert.equal(edge.kind, "imports");
    });

    test("golden snapshot matches", async () => {
      const { wrote, existing } = await checkGolden("auth_ts", result);
      if (!wrote) {
        assert.deepEqual(result.symbols.map((s) => s.name), existing.symbols.map((s) => s.name));
        assert.equal(result.symbols.length, existing.symbols.length);
      }
    });
  });

  describe("router.ts", () => {
    let result;

    before(async () => {
      const { bytes, relPath } = await loadFixture("router.ts");
      result = await extractSymbolsAndEdges(relPath, bytes, "typescript");
    });

    test("extracts Router class", () => {
      const sym = result.symbols.find((s) => s.name === "Router");
      assert.ok(sym, "Router class not found");
      assert.equal(sym.kind, "class");
      assert.equal(sym.exported, 1);
    });

    test("extracts Router methods: get, post, dispatch", () => {
      const names = result.symbols.filter((s) => s.kind === "method").map((s) => s.name);
      assert.ok(names.includes("get"), "get method missing");
      assert.ok(names.includes("post"), "post method missing");
      assert.ok(names.includes("dispatch"), "dispatch method missing");
    });

    test("extracts createRouter factory function", () => {
      const sym = result.symbols.find((s) => s.name === "createRouter");
      assert.ok(sym, "createRouter not found");
      assert.equal(sym.kind, "function");
      assert.equal(sym.exported, 1);
    });

    test("extracts Handler type alias", () => {
      const sym = result.symbols.find((s) => s.name === "Handler");
      assert.ok(sym, "Handler not found");
      assert.equal(sym.kind, "type");
    });

    test("import edge to auth.js present", () => {
      const edge = result.edges.find((e) => e.raw_target === "./auth.js");
      assert.ok(edge, "auth.js import edge not found");
    });
  });

  describe("index.ts", () => {
    let result;

    before(async () => {
      const { bytes, relPath } = await loadFixture("index.ts");
      result = await extractSymbolsAndEdges(relPath, bytes, "typescript");
    });

    test("import edges to auth.js and router.js", () => {
      const targets = result.edges.map((e) => e.raw_target);
      assert.ok(targets.includes("./auth.js"), "auth.js import missing");
      assert.ok(targets.includes("./router.js"), "router.js import missing");
    });
  });
});

describe("TypeScript symbol extraction — ts-medium fixture", () => {
  const MEDIUM = join(__dirname, "fixtures", "ts-medium", "src");

  async function loadMedium(name) {
    const absPath = join(MEDIUM, name);
    const bytes = await readFile(absPath);
    return { bytes, relPath: `src/${name}` };
  }

  test("config.ts exports loadConfig and validateConfig", async () => {
    const { bytes, relPath } = await loadMedium("config.ts");
    const result = await extractSymbolsAndEdges(relPath, bytes, "typescript");
    const names = result.symbols.map((s) => s.name);
    assert.ok(names.includes("loadConfig"), "loadConfig missing");
    assert.ok(names.includes("validateConfig"), "validateConfig missing");
    assert.ok(names.includes("Config"), "Config interface missing");
    assert.ok(names.includes("DatabaseConfig"), "DatabaseConfig missing");
    assert.ok(names.includes("Environment"), "Environment missing");
  });

  test("cache.ts exports Cache class and memoize function", async () => {
    const { bytes, relPath } = await loadMedium("cache.ts");
    const result = await extractSymbolsAndEdges(relPath, bytes, "typescript");
    const names = result.symbols.map((s) => s.name);
    assert.ok(names.includes("Cache"), "Cache class missing");
    assert.ok(names.includes("memoize"), "memoize missing");
  });

  test("events.ts exports EventEmitter class", async () => {
    const { bytes, relPath } = await loadMedium("events.ts");
    const result = await extractSymbolsAndEdges(relPath, bytes, "typescript");
    const cls = result.symbols.find((s) => s.name === "EventEmitter");
    assert.ok(cls, "EventEmitter missing");
    assert.equal(cls.kind, "class");
    const methodNames = result.symbols
      .filter((s) => s.kind === "method" && s.container === "EventEmitter")
      .map((s) => s.name);
    assert.ok(methodNames.includes("on"), "on method missing");
    assert.ok(methodNames.includes("off"), "off method missing");
    assert.ok(methodNames.includes("emit"), "emit method missing");
  });
});
