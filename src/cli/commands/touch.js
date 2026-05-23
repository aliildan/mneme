import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectHash } from "../../project/project-hash.js";
import { projectDir } from "../../config/paths.js";

// Fast, side-effect-only command for Claude Code PostToolUse hooks:
// mark the project index dirty so the next mneme MCP call revalidates,
// bypassing the 250ms debounce.
export async function touch() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let hash;
  try { hash = projectHash(root); } catch { return; }
  const dir = projectDir(hash);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".dirty"), String(Date.now()));
}
