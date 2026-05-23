import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectLanguage } from "../src/fs/walker.js";
import { extractFromFile } from "../src/index/extract-symbols.js";
import { getPlugin } from "../src/parser/languages/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

describe("detectLanguage extension dispatch", () => {
  test("TypeScript extensions resolve to typescript", () => {
    assert.equal(detectLanguage("src/foo.ts"), "typescript");
    assert.equal(detectLanguage("src/foo.tsx"), "typescript");
    assert.equal(detectLanguage("src/foo.js"), "typescript");
    assert.equal(detectLanguage("src/foo.jsx"), "typescript");
    assert.equal(detectLanguage("src/foo.mjs"), "typescript");
    assert.equal(detectLanguage("src/foo.cjs"), "typescript");
  });

  test(".d.ts declaration files are unknown (no symbols extracted)", () => {
    assert.equal(detectLanguage("src/foo.d.ts"), "unknown");
  });

  test("Python extensions resolve to python", () => {
    assert.equal(detectLanguage("src/foo.py"), "python");
    assert.equal(detectLanguage("src/foo.pyw"), "python");
  });

  test("Go extension resolves to go", () => {
    assert.equal(detectLanguage("cmd/server/main.go"), "go");
  });

  test("Rust extension resolves to rust", () => {
    assert.equal(detectLanguage("src/lib.rs"), "rust");
  });

  test("PHP extensions resolve to php", () => {
    assert.equal(detectLanguage("src/Auth.php"), "php");
    assert.equal(detectLanguage("templates/view.phtml"), "php");
  });

  test("C# extension resolves to csharp", () => {
    assert.equal(detectLanguage("Services/Auth.cs"), "csharp");
  });

  test("unknown extensions fall through to unknown", () => {
    assert.equal(detectLanguage("README.md"), "unknown");
    assert.equal(detectLanguage("Makefile"), "unknown");
    assert.equal(detectLanguage("src/foo.txt"), "unknown");
  });

  test("paths with no extension are unknown", () => {
    assert.equal(detectLanguage("LICENSE"), "unknown");
  });
});

describe("language plugin registry", () => {
  test("registry exposes python/go/rust/php/csharp", () => {
    assert.ok(getPlugin("python"), "python plugin missing");
    assert.ok(getPlugin("go"), "go plugin missing");
    assert.ok(getPlugin("rust"), "rust plugin missing");
    assert.ok(getPlugin("php"), "php plugin missing");
    assert.ok(getPlugin("csharp"), "csharp plugin missing");
  });

  test("unknown language returns null from registry", () => {
    assert.equal(getPlugin("cobol"), null);
    assert.equal(getPlugin("unknown"), null);
  });
});

describe("extractFromFile dispatches by language", () => {
  test("python fixture is parsed via plugin (non-empty symbols)", async () => {
    const absPath = join(FIXTURES, "py-small", "auth.py");
    const result = await extractFromFile(absPath, "auth.py", "python");
    assert.equal(result.parseOk, true);
    assert.ok(result.symbols.length > 0, "expected symbols from python plugin");
    const names = result.symbols.map((s) => s.name);
    assert.ok(names.includes("hash_password"));
    assert.ok(names.includes("AuthService"));
  });

  test("go fixture is parsed via plugin (non-empty symbols + edges)", async () => {
    const absPath = join(FIXTURES, "go-small", "server.go");
    const result = await extractFromFile(absPath, "server.go", "go");
    assert.equal(result.parseOk, true);
    assert.ok(result.symbols.length > 0, "expected symbols from go plugin");
    const names = result.symbols.map((s) => s.name);
    assert.ok(names.includes("Config"));
    assert.ok(names.includes("NewConfig"));
    const edgeTargets = result.edges.map((e) => e.raw_target);
    assert.ok(edgeTargets.includes("fmt"));
  });

  test("rust fixture is parsed via plugin (non-empty symbols)", async () => {
    const absPath = join(FIXTURES, "rs-small", "lib.rs");
    const result = await extractFromFile(absPath, "lib.rs", "rust");
    assert.equal(result.parseOk, true);
    assert.ok(result.symbols.length > 0, "expected symbols from rust plugin");
    const names = result.symbols.map((s) => s.name);
    assert.ok(names.includes("Config"));
    assert.ok(names.includes("Status"));
    assert.ok(names.includes("Handler"));
  });

  test("unknown language returns empty result without erroring", async () => {
    const absPath = join(FIXTURES, "rs-small", "lib.rs");
    const result = await extractFromFile(absPath, "lib.rs", "unknown");
    assert.equal(result.parseOk, true);
    assert.deepEqual(result.symbols, []);
    assert.deepEqual(result.edges, []);
  });

  test("missing file returns parseOk=false without throwing", async () => {
    const result = await extractFromFile("/nonexistent/path/foo.py", "foo.py", "python");
    assert.equal(result.parseOk, false);
    assert.ok(result.parseError);
  });

  test("php fixture is parsed via plugin (non-empty symbols)", async () => {
    const absPath = join(FIXTURES, "php-small", "auth.php");
    const result = await extractFromFile(absPath, "auth.php", "php");
    assert.equal(result.parseOk, true);
    assert.ok(result.symbols.length > 0, "expected symbols from php plugin");
    const names = result.symbols.map((s) => s.name);
    assert.ok(names.includes("AuthService"));
    assert.ok(names.includes("hash_password"));
  });

  test("csharp fixture is parsed via plugin (non-empty symbols)", async () => {
    const absPath = join(FIXTURES, "cs-small", "AuthService.cs");
    const result = await extractFromFile(absPath, "AuthService.cs", "csharp");
    assert.equal(result.parseOk, true);
    assert.ok(result.symbols.length > 0, "expected symbols from csharp plugin");
    const names = result.symbols.map((s) => s.name);
    assert.ok(names.includes("AuthService"));
    assert.ok(names.includes("IAuthService"));
  });

  test("typescript still routes through the legacy ts-extract path", async () => {
    const absPath = join(FIXTURES, "ts-small", "src", "auth.ts");
    const result = await extractFromFile(absPath, "src/auth.ts", "typescript");
    assert.equal(result.parseOk, true);
    const names = result.symbols.map((s) => s.name);
    assert.ok(names.includes("AuthService"));
    assert.ok(names.includes("hashPassword"));
  });
});
