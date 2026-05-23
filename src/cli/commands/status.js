import { detectRoot } from "../../project/detect-root.js";
import { projectHash } from "../../project/project-hash.js";
import { projectDbPath } from "../../config/paths.js";
import { openProjectDb } from "../../db/open.js";
import { migrateProjectDb } from "../../db/migrate.js";
import { getDbCounts } from "../../index/index-writer.js";
import { getStmts } from "../../db/statements.js";
import { loadConfig } from "../../config/mneme-config.js";
import { daemonPaths } from "../daemon.js";

export async function status(args) {
  const root = await detectRoot();
  const hash = projectHash(root);
  const dbPath = projectDbPath(hash);

  const config = await loadConfig();

  let db;
  try {
    db = await openProjectDb(hash, dbPath);
    migrateProjectDb(db);
  } catch (err) {
    console.log(`Project: ${root} (hash: ${hash})`);
    console.log(`Database: ${dbPath} — NOT INITIALIZED (run 'mneme init')`);
    return;
  }

  const stmts = getStmts(db);
  const getMeta = (key) => stmts.getMeta.get(key)?.value ?? null;
  const counts = getDbCounts(db);
  const lastValidated = getMeta("last_validated_at");

  console.log(`Project:          ${root}`);
  console.log(`Hash:             ${hash}`);
  console.log(`Database:         ${dbPath}`);
  console.log(`Schema version:   ${getMeta("schema_version") ?? 1}`);
  console.log(`Languages:        ${(config.indexer?.languages ?? ["typescript"]).join(", ")}`);
  console.log(`Files:            ${counts.files}`);
  console.log(`Symbols:          ${counts.symbols}`);
  console.log(`Edges:            ${counts.edges}`);
  console.log(`Last validated:   ${lastValidated ? new Date(Number(lastValidated)).toISOString() : "never"}`);
  console.log(`Merkle root:      ${getMeta("merkle_root") ?? "(none)"}`);
  console.log(`Discovery model:  ${config.discoveryModel ?? "(none)"}`);
  console.log(`PID file:         ${daemonPaths.pidFile}`);
  console.log(`Log file:         ${daemonPaths.logFile}`);
}
