import { resolveAllowedProjects } from "./registry.js";
import { openProjectDb, openGlobalDb } from "../db/open.js";
import { migrateProjectDb, migrateGlobalDb } from "../db/migrate.js";
import { interpolateEnv } from "../config/mneme-config.js";
import { sep } from "node:path";
import { log } from "../util/logger.js";

// Query memory only (never symbols/code) from opted-in projects + global.
// allowList: array of project hashes OR absolute db paths (paths start with / or drive letter)
export async function federatedRecall({ query, limit = 20, allowList = [], globalDbPath }) {
  const results = [];

  for (const entry of allowList ?? []) {
    // Accept both project hashes and direct absolute db paths
    const isAbsPath = typeof entry === "string" && (entry.startsWith("/") || entry.startsWith(sep) || /^[A-Za-z]:/.test(entry));

    let dbPath;
    let hash;
    if (isAbsPath) {
      dbPath = entry;
      hash = entry;
    } else {
      // It's a project hash — resolve via standard path
      const resolved = await resolveAllowedProjects([entry]);
      if (!resolved.length) continue;
      ({ hash, dbPath } = resolved[0]);
    }

    try {
      const db = await openProjectDb(hash, dbPath);
      migrateProjectDb(db);
      const rows = queryMemory(db, query, limit);
      results.push(...rows.map((r) => ({ ...r, source_db: dbPath, project_hash: hash, scope: r.scope ?? "project" })));
    } catch (err) {
      log.warn(`federated: project DB read failed (${dbPath}): ${err.message}`);
    }
  }

  // Also include global
  if (globalDbPath) {
    try {
      const resolvedPath = interpolateEnv(globalDbPath);
      const gDb = await openGlobalDb(resolvedPath);
      migrateGlobalDb(gDb);
      const rows = queryMemory(gDb, query, limit);
      results.push(...rows.map((r) => ({ ...r, source_db: resolvedPath, project_hash: "global", scope: "global" })));
    } catch (err) {
      log.warn(`federated: global DB read failed: ${err.message}`);
    }
  }

  // Sort by BM25 score desc
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { matches: results.slice(0, limit) };
}

function queryMemory(db, query, limit) {
  const hasFts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'").get();
  if (!query || !hasFts) {
    return db.prepare(
      "SELECT *, 0 AS score FROM memory WHERE forgotten_at IS NULL ORDER BY created_at DESC LIMIT ?"
    ).all(limit);
  }
  try {
    const ftsTokens = query.split(/[\s\-_./\\:,"'`]+/).filter((t) => t.length >= 2);
    if (!ftsTokens.length) return [];
    const ftsQuery = ftsTokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
    return db.prepare(`
      SELECT m.*, bm25(memory_fts) AS score
      FROM memory_fts
      JOIN memory m ON memory_fts.rowid = m.id
      WHERE memory_fts MATCH ? AND m.forgotten_at IS NULL
      LIMIT ?
    `).all(ftsQuery, limit);
  } catch (err) {
    log.warn(`federated: FTS5 query failed: ${err.message}`);
    return [];
  }
}
