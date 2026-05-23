import { opendir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildIgnoreFilter, isBinary } from "./ignore.js";

const TS_JS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PY_EXTS = new Set([".py", ".pyw"]);
const GO_EXTS = new Set([".go"]);
const RUST_EXTS = new Set([".rs"]);
const PHP_EXTS = new Set([".php", ".phtml", ".phar"]);
const CSHARP_EXTS = new Set([".cs"]);

export function detectLanguage(relPath) {
  if (relPath.endsWith(".d.ts")) return "unknown";
  const dot = relPath.lastIndexOf(".");
  if (dot < 0) return "unknown";
  const ext = relPath.slice(dot).toLowerCase();
  if (TS_JS_EXTS.has(ext)) return "typescript";
  if (PY_EXTS.has(ext)) return "python";
  if (GO_EXTS.has(ext)) return "go";
  if (RUST_EXTS.has(ext)) return "rust";
  if (PHP_EXTS.has(ext)) return "php";
  if (CSHARP_EXTS.has(ext)) return "csharp";
  return "unknown";
}

// Async generator that yields { absPath, relPath, size, mtimeMs, language }
// in lexicographic order (reproducible for Merkle hashing).
export async function* walkProject(projectRoot, { maxFileBytes = 1048576, ignore: extraIgnore = [] } = {}) {
  const filter = await buildIgnoreFilter(projectRoot, extraIgnore);
  yield* walkDir(projectRoot, projectRoot, filter, maxFileBytes);
}

async function* walkDir(projectRoot, absDir, filter, maxFileBytes) {
  let entries;
  try {
    const dir = await opendir(absDir);
    entries = [];
    for await (const ent of dir) entries.push(ent);
  } catch { return; }

  // Lexicographic sort so Merkle hashes are reproducible.
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  for (const ent of entries) {
    const absPath = join(absDir, ent.name);
    const relPath = relative(projectRoot, absPath).replace(/\\/g, "/");

    if (filter.ignores(relPath)) continue;

    if (ent.isDirectory()) {
      yield* walkDir(projectRoot, absPath, filter, maxFileBytes);
    } else if (ent.isFile()) {
      try {
        const info = await stat(absPath);
        if (info.size > maxFileBytes) continue;
        // Binary sniff — read up to 8 KB
        try {
          const first = await readFirst8KB(absPath);
          if (isBinary(first)) continue;
        } catch { continue; }

        yield {
          absPath,
          relPath,
          size: info.size,
          mtimeMs: Math.floor(info.mtimeMs),
          language: detectLanguage(relPath),
        };
      } catch {}
    }
  }
}

async function readFirst8KB(absPath) {
  const fh = await import("node:fs/promises").then((m) => m.open(absPath, "r"));
  try {
    const buf = Buffer.allocUnsafe(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// Collect directory entries for Merkle diff without yielding file objects.
// Returns sorted [{ name, kind: 'file'|'dir', relPath }].
export async function listDir(absDir, projectRoot, filter) {
  let entries;
  try {
    const dir = await opendir(absDir);
    entries = [];
    for await (const ent of dir) entries.push(ent);
  } catch { return []; }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const result = [];
  for (const ent of entries) {
    const relPath = relative(projectRoot, join(absDir, ent.name)).replace(/\\/g, "/");
    if (filter.ignores(relPath)) continue;
    if (ent.isDirectory() || ent.isFile()) {
      result.push({ name: ent.name, kind: ent.isDirectory() ? "dir" : "file", relPath });
    }
  }
  return result;
}
