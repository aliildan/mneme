import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(__dir, "../../../skills/mneme/SKILL.md");

export async function installSkill(projectRoot) {
  const dest = join(projectRoot, ".claude", "skills", "mneme");
  await mkdir(dest, { recursive: true });
  const content = await readFile(SOURCE, "utf8");
  await writeFile(join(dest, "SKILL.md"), content);
}
