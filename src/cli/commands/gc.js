import { detectRoot } from "../../project/detect-root.js";
import { projectHash } from "../../project/project-hash.js";
import { projectDbPath } from "../../config/paths.js";
import { openProjectDb } from "../../db/open.js";
import { migrateProjectDb } from "../../db/migrate.js";
import { gcMemory } from "../../memory/gc.js";
import { loadConfig, interpolateEnv } from "../../config/mneme-config.js";

export async function gc(args) {
  let days = 90;
  const daysFlag = args.indexOf("--days");
  if (daysFlag !== -1 && args[daysFlag + 1]) {
    days = Number(args[daysFlag + 1]);
    if (!Number.isInteger(days) || days < 1) { console.error("--days must be a positive integer"); process.exit(1); }
  }

  const root = await detectRoot();
  const hash = projectHash(root);
  const dbPath = projectDbPath(hash);

  const db = await openProjectDb(hash, dbPath);
  migrateProjectDb(db);
  const config = await loadConfig();
  const globalDbPath = interpolateEnv(config.memory?.globalDbPath ?? "$HOME/.openclaude/mneme/global.db");

  const result = await gcMemory(db, globalDbPath, { olderThanDays: days });
  console.log(`GC complete — soft-deleted ${result.softDeleted} memories older than ${days} days.`);
}
