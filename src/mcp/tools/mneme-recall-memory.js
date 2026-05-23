import { recallMemory } from "../../memory/recall.js";
import { interpolateEnv } from "../../config/mneme-config.js";
import { log } from "../../util/logger.js";

export async function handleRecallMemory(args, { db, config }) {
  const { query, kind = "any", scope = "any", files, tags, limit = 20 } = args;
  const globalDbPath = interpolateEnv(config.memory?.globalDbPath ?? "$HOME/.openclaude/mneme/global.db");

  const matches = await recallMemory(db, globalDbPath, { query, kind, scope, files, tags, limit });

  // Bump recall counters on the project DB only — matches that came from global
  // won't have a row here and are skipped silently by the WHERE clause.
  const update = db.prepare("UPDATE memory SET recall_count = recall_count + 1, last_recalled_at = ? WHERE id = ?");
  for (const m of matches) {
    try {
      update.run(Date.now(), m.id);
    } catch (err) {
      log.warn(`recall: failed to bump recall_count for id=${m.id}: ${err.message}`);
    }
  }

  return { matches };
}
