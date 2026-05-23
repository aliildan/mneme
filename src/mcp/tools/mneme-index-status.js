import { getStmts } from "../../db/statements.js";
import { getDbCounts } from "../../index/index-writer.js";

export async function handleIndexStatus(args, { db, dbPath, projectRoot, hash, config }) {
  const stmts = getStmts(db);

  const getMeta = (key) => stmts.getMeta.get(key)?.value ?? null;
  const counts = getDbCounts(db);

  return {
    project_root: projectRoot,
    project_hash: hash,
    db_path: dbPath,
    schema_version: Number(getMeta("schema_version") ?? 1),
    languages: config.indexer?.languages ?? ["typescript"],
    counts,
    last_validated_at: getMeta("last_validated_at") ? Number(getMeta("last_validated_at")) : null,
    merkle_root: getMeta("merkle_root"),
    discovery_model: config.discoveryModel ?? null,
  };
}
