import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { readFile } from "node:fs/promises";

const __dir = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(__dir, "../../../slash-commands/mneme.md");

export async function installSlashCommand(projectRoot) {
  const dest = join(projectRoot, ".claude", "commands");
  await mkdir(dest, { recursive: true });
  const content = await readFile(SOURCE, "utf8");
  await writeFile(join(dest, "mneme.md"), content);
}
