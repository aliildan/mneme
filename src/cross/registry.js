import { projectDir, projectDbPath } from "../config/paths.js";
import { stat } from "node:fs/promises";

// Returns a list of project DB paths that are in the allow list and actually exist.
export async function resolveAllowedProjects(allowList) {
  const resolved = [];
  for (const hash of allowList ?? []) {
    const dbPath = projectDbPath(hash);
    try {
      await stat(dbPath);
      resolved.push({ hash, dbPath });
    } catch {}
  }
  return resolved;
}
