import { interpolateEnv } from "../config/mneme-config.js";
import { openGlobalDb } from "../db/open.js";
import { migrateGlobalDb } from "../db/migrate.js";
import { log } from "../util/logger.js";

export async function recallMemory(projectDb, globalDbPath, {
  query, kind = "any", scope = "any", files, tags, limit = 20
} = {}) {
  const results = [];

  // Project DB
  if (scope === "any" || scope === "project") {
    const rows = queryDb(projectDb, { query, kind, files, tags, limit });
    results.push(...rows.map((r) => ({ ...r, _source: "project" })));
  }

  // Global DB
  if (scope === "any" || scope === "global") {
    try {
      const resolvedPath = interpolateEnv(globalDbPath);
      const gDb = await openGlobalDb(resolvedPath);
      migrateGlobalDb(gDb);
      const rows = queryDb(gDb, { query, kind, files, tags, limit });
      results.push(...rows.map((r) => ({ ...r, _source: "global", score: (r.score ?? 0) * 0.9 })));
    } catch (err) {
      log.warn(`recall: global DB read failed: ${err.message}`);
    }
  }

  // Merge and sort by score desc, then by created_at desc
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.created_at - a.created_at);
  return results.slice(0, limit).map(({ _source, ...r }) => r);
}

function queryDb(db, { query, kind, files, tags, limit }) {
  const hasFts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'").get();
  const rows = [];

  if (query && hasFts) {
    try {
      const ftsTokens = query
        .trim()
        .split(/[\s\-_./\\:,"'`]+/)
        .map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
        .filter((t) => t.length >= 2);
      if (!ftsTokens.length) return rows;
      const ftsQuery = ftsTokens.map((t) => `${t}*`).join(" OR ");
      const ftsRows = db.prepare(`
        SELECT m.*, bm25(memory_fts) AS score
        FROM memory_fts
        JOIN memory m ON memory_fts.rowid = m.id
        WHERE memory_fts MATCH ? AND m.forgotten_at IS NULL
        ORDER BY score
        LIMIT ?
      `).all(ftsQuery, limit);
      rows.push(...ftsRows);
    } catch (err) {
      log.warn(`recall: FTS5 query failed (${err.message}); falling back to non-FTS path`);
    }
  }

  if (!query || rows.length === 0) {
    let sql = "SELECT *, 0 AS score FROM memory WHERE forgotten_at IS NULL";
    const params = [];
    if (kind !== "any") { sql += " AND kind = ?"; params.push(kind); }
    if (files?.length) { sql += " AND files LIKE ?"; params.push(`%${files[0]}%`); }
    if (tags?.length) { sql += " AND tags LIKE ?"; params.push(`%${tags[0]}%`); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    rows.push(...db.prepare(sql).all(...params));
  }

  return rows.filter((r) => r.forgotten_at == null).map((r) => ({
    id: r.id,
    kind: r.kind,
    body: r.body,
    scope: r.scope,
    task: r.task ?? null,
    files: parseJsonField(r.files, "files", r.id),
    identifiers: parseJsonField(r.identifiers, "identifiers", r.id),
    tags: parseJsonField(r.tags, "tags", r.id),
    source: r.source,
    created_at: r.created_at,
    score: Math.abs(r.score ?? 0),
  }));
}

function parseJsonField(value, field, id) {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch (err) {
    log.warn(`recall: malformed JSON in ${field} for memory id=${id}: ${err.message}`);
    return null;
  }
}

export async function listMemories(projectDb, globalDbPath, { scope = "any", kind = "any", limit = 20, offset = 0 } = {}) {
  const all = [];
  if (scope === "any" || scope === "project") {
    all.push(...listDb(projectDb, { kind, limit: limit + offset }));
  }
  if (scope === "any" || scope === "global") {
    try {
      const resolvedPath = interpolateEnv(globalDbPath);
      const gDb = await openGlobalDb(resolvedPath);
      all.push(...listDb(gDb, { kind, limit: limit + offset }));
    } catch (err) {
      log.warn(`list: global DB read failed: ${err.message}`);
    }
  }
  all.sort((a, b) => b.created_at - a.created_at);
  return all.slice(offset, offset + limit);
}

function listDb(db, { kind, limit }) {
  let sql = "SELECT * FROM memory WHERE forgotten_at IS NULL";
  const params = [];
  if (kind !== "any") { sql += " AND kind = ?"; params.push(kind); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  try {
    return db.prepare(sql).all(...params);
  } catch (err) {
    log.warn(`listDb: query failed: ${err.message}`);
    return [];
  }
}
