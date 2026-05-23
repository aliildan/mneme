import { interpolateEnv } from "../config/mneme-config.js";
import { openGlobalDb } from "../db/open.js";
import { migrateGlobalDb } from "../db/migrate.js";
import { log } from "../util/logger.js";

// Manual GC — never time-triggered.
// Soft-deletes: rows older than N days AND recall_count == 0, not pinned.
export async function gcMemory(projectDb, globalDbPath, { olderThanDays = 90 } = {}) {
  const cutoff = Date.now() - olderThanDays * 86_400_000;
  let total = 0;

  total += runGc(projectDb, cutoff);

  try {
    const resolvedPath = interpolateEnv(globalDbPath);
    const gDb = await openGlobalDb(resolvedPath);
    migrateGlobalDb(gDb);
    total += runGc(gDb, cutoff);
  } catch (err) {
    log.warn(`gc: skipped global DB (${err.message})`);
  }

  return { softDeleted: total, olderThanDays };
}

function runGc(db, cutoff) {
  try {
    const result = db.prepare(`
      UPDATE memory SET forgotten_at = ?
      WHERE forgotten_at IS NULL
        AND created_at < ?
        AND recall_count = 0
        AND (tags IS NULL OR tags NOT LIKE '%"pinned"%')
    `).run(Date.now(), cutoff);
    return result.changes;
  } catch { return 0; }
}
