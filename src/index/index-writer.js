import { getStmts } from "../db/statements.js";
import { log } from "../util/logger.js";

export function upsertFile(db, { relPath, language, sizeBytes, mtimeMs, contentHash, parsedAt, parseOk, parseError }) {
  const stmts = getStmts(db);
  stmts.upsertFile.run({
    rel_path: relPath,
    language,
    size_bytes: sizeBytes,
    mtime_ms: mtimeMs,
    content_hash: contentHash,
    parsed_at: parsedAt,
    parse_ok: parseOk ? 1 : 0,
    parse_error: parseError ?? null,
  });
  return stmts.getFileByPath.get(relPath);
}

export function replaceSymbolsForFile(db, fileId, symbols) {
  const stmts = getStmts(db);
  stmts.deleteSymbolsByFile.run(fileId);
  for (const sym of symbols) {
    stmts.insertSymbol.run({ file_id: fileId, ...sym });
  }
}

export function replaceEdgesForFile(db, fileId, edges) {
  const stmts = getStmts(db);
  stmts.deleteEdgesByFile.run(fileId);
  for (const edge of edges) {
    stmts.insertEdge.run({
      src_file: fileId,
      src_sym: edge.src_sym ?? null,
      dst_name: edge.dst_name,
      dst_file: edge.dst_file ?? null,
      dst_sym: edge.dst_sym ?? null,
      kind: edge.kind,
      raw_target: edge.raw_target ?? null,
    });
  }
}

export function resolveEdges(db) {
  // Second pass: fill in dst_file and dst_sym for edges where dst_name is known.
  const stmts = getStmts(db);
  const symbols = db.prepare("SELECT id, name, file_id FROM symbols").all();
  const byName = new Map();
  for (const s of symbols) {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
  }

  const edges = db.prepare("SELECT id, dst_name FROM edges WHERE dst_file IS NULL").all();
  const update = db.prepare("UPDATE edges SET dst_file = ?, dst_sym = ? WHERE id = ?");

  for (const edge of edges) {
    const matches = byName.get(edge.dst_name);
    if (matches && matches.length === 1) {
      // Unambiguous: resolve
      update.run(matches[0].file_id, matches[0].id, edge.id);
    }
    // Ambiguous or missing: leave dst_file/dst_sym NULL — low-weight in ranker
  }
}

export function deleteFileCascade(db, relPath) {
  const stmts = getStmts(db);
  const file = stmts.getFileByPath.get(relPath);
  if (file) stmts.deleteFile.run(relPath); // CASCADE deletes symbols + edges
}

export function getDbCounts(db) {
  const stmts = getStmts(db);
  return {
    files: stmts.countFiles.get().n,
    symbols: stmts.countSymbols.get().n,
    edges: stmts.countEdges.get().n,
  };
}
