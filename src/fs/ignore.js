import ignore from "ignore";
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export async function buildIgnoreFilter(projectRoot, extraPatterns = []) {
  const ig = ignore();

  // Extra patterns from config (always applied)
  if (extraPatterns.length) ig.add(extraPatterns);

  // .mnemeignore at project root (highest precedence)
  await tryAddIgnoreFile(ig, join(projectRoot, ".mnemeignore"));

  // .gitignore at project root
  await tryAddIgnoreFile(ig, join(projectRoot, ".gitignore"));

  return {
    ignores(relPath) {
      // ignore package normalizes paths — always use forward slashes
      return ig.ignores(relPath.replace(/\\/g, "/"));
    },
    addSubdir(dirRelPath) {
      // Returns a new filter that also applies .gitignore from a sub-directory.
      // Call this lazily as walker descends.
      return buildSubdirFilter(ig, projectRoot, dirRelPath);
    },
  };
}

async function buildSubdirFilter(parentIg, projectRoot, dirRelPath) {
  const gi = join(projectRoot, dirRelPath, ".gitignore");
  const sub = parentIg.add([]);
  await tryAddIgnoreFile(sub, gi, dirRelPath);
  return sub;
}

async function tryAddIgnoreFile(ig, filePath, prefix = "") {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const prefixed = prefix
      ? lines.map((l) => (l.startsWith("/") ? join(prefix, l.slice(1)) : l))
      : lines;
    ig.add(prefixed);
  } catch {}
}

// Fast binary-file detection: if first 8 KB contains a NUL byte, skip.
export function isBinary(bytes) {
  const check = Math.min(bytes.length, 8192);
  for (let i = 0; i < check; i++) if (bytes[i] === 0) return true;
  return false;
}
