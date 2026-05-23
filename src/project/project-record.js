import { readFile, writeFile } from "node:fs/promises";
import { projectJsonPath, ensureProjectDir } from "../config/paths.js";

export async function readProjectRecord(projectHash) {
  try {
    const raw = await readFile(projectJsonPath(projectHash), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeProjectRecord(projectHash, record) {
  await ensureProjectDir(projectHash);
  await writeFile(
    projectJsonPath(projectHash),
    JSON.stringify({ ...record, updatedAt: Date.now() }, null, 2) + "\n"
  );
}
