import { stat, realpath } from "node:fs/promises";
import { join, dirname } from "node:path";

const MARKERS = [".mneme", ".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];
const MAX_LEVELS = 8;

export async function detectRoot(startDir) {
  if (process.env.MNEME_PROJECT_ROOT) {
    try { return await realpath(process.env.MNEME_PROJECT_ROOT); } catch {}
  }

  let dir = startDir ?? process.cwd();
  for (let i = 0; i < MAX_LEVELS; i++) {
    for (const marker of MARKERS) {
      try {
        await stat(join(dir, marker));
        return await realpath(dir);
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // No marker found — fall back to cwd
  const cwd = await realpath(startDir ?? process.cwd());
  process.stderr.write(`[mneme] WARN no project marker found within ${MAX_LEVELS} levels; using ${cwd}\n`);
  return cwd;
}
