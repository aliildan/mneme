import { detectRoot } from "../../project/detect-root.js";
import { projectHash } from "../../project/project-hash.js";
import { projectDbPath } from "../../config/paths.js";
import { openProjectDb } from "../../db/open.js";
import { migrateProjectDb } from "../../db/migrate.js";
import { fullReindex } from "../../index/validator.js";
import { getDbCounts } from "../../index/index-writer.js";
import { loadConfig } from "../../config/mneme-config.js";

export async function reindex(args) {
  const root = await detectRoot();
  const hash = projectHash(root);
  const dbPath = projectDbPath(hash);

  console.log(`Reindexing ${root}…`);

  const db = await openProjectDb(hash, dbPath);
  migrateProjectDb(db);
  const config = await loadConfig();

  const result = await fullReindex(db, root, config);
  const counts = getDbCounts(db);

  console.log(`Done — dirty:${result.dirty ?? 0} removed:${result.removed ?? 0} in ${result.tookMs ?? 0}ms`);
  console.log(`  Files:   ${counts.files}`);
  console.log(`  Symbols: ${counts.symbols}`);
  console.log(`  Edges:   ${counts.edges}`);
}
