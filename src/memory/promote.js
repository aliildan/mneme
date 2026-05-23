import { interpolateEnv } from "../config/mneme-config.js";
import { openGlobalDb } from "../db/open.js";
import { migrateGlobalDb } from "../db/migrate.js";

// Explicitly promote a project-local memory row to global.db.
// Mneme NEVER auto-promotes — this requires an explicit agent or user call.
export async function promoteMemory(projectDb, globalDbPath, { id }) {
  const row = projectDb.prepare("SELECT * FROM memory WHERE id = ? AND forgotten_at IS NULL").get(id);
  if (!row) throw new Error(`Memory id ${id} not found or already forgotten`);
  if (row.scope === "global") throw new Error(`Memory id ${id} is already global scope`);

  const resolvedPath = interpolateEnv(globalDbPath);
  const gDb = await openGlobalDb(resolvedPath);
  migrateGlobalDb(gDb);

  const result = gDb.prepare(`
    INSERT INTO memory (kind, body, scope, task, files, identifiers, tags, source, created_at)
    VALUES (?, ?, 'global', ?, ?, ?, ?, 'promoted', ?)
  `).run(row.kind, row.body, row.task, row.files, row.identifiers, row.tags, Date.now());

  return { globalId: result.lastInsertRowid, originalId: id };
}
