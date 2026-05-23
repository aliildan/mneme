// Prepared statement cache — call getStmts(db) once per db instance.
const cache = new WeakMap();

export function getStmts(db) {
  if (cache.has(db)) return cache.get(db);
  const s = buildStmts(db);
  cache.set(db, s);
  return s;
}

function buildStmts(db) {
  return {
    // meta
    getMeta: db.prepare("SELECT value FROM meta WHERE key = ?"),
    setMeta: db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"),

    // merkle_nodes
    getMerkleRoot: db.prepare("SELECT hash FROM merkle_nodes WHERE rel_path = ''"),
    getMerkleNode: db.prepare("SELECT * FROM merkle_nodes WHERE rel_path = ?"),
    getMerkleChildren: db.prepare("SELECT * FROM merkle_nodes WHERE parent = ? ORDER BY rel_path"),
    upsertMerkleNode: db.prepare(
      "INSERT OR REPLACE INTO merkle_nodes (rel_path, kind, hash, parent, updated_at) VALUES (?, ?, ?, ?, ?)"
    ),
    deleteMerkleNode: db.prepare("DELETE FROM merkle_nodes WHERE rel_path = ?"),
    deleteMerkleSubtree: db.prepare("DELETE FROM merkle_nodes WHERE rel_path = ? OR rel_path LIKE ?"),

    // files
    getFileByPath: db.prepare("SELECT * FROM files WHERE rel_path = ?"),
    getFileById: db.prepare("SELECT * FROM files WHERE id = ?"),
    upsertFile: db.prepare(`
      INSERT INTO files (rel_path, language, size_bytes, mtime_ms, content_hash, parsed_at, parse_ok, parse_error)
      VALUES (@rel_path, @language, @size_bytes, @mtime_ms, @content_hash, @parsed_at, @parse_ok, @parse_error)
      ON CONFLICT(rel_path) DO UPDATE SET
        language = excluded.language,
        size_bytes = excluded.size_bytes,
        mtime_ms = excluded.mtime_ms,
        content_hash = excluded.content_hash,
        parsed_at = excluded.parsed_at,
        parse_ok = excluded.parse_ok,
        parse_error = excluded.parse_error
    `),
    deleteFile: db.prepare("DELETE FROM files WHERE rel_path = ?"),
    countFiles: db.prepare("SELECT COUNT(*) AS n FROM files"),
    filesPathLike: db.prepare("SELECT id FROM files WHERE rel_path LIKE ?"),

    // symbols
    symbolById: db.prepare("SELECT * FROM symbols WHERE id = ?"),
    symbolsByFile: db.prepare("SELECT * FROM symbols WHERE file_id = ?"),
    countSymbols: db.prepare("SELECT COUNT(*) AS n FROM symbols"),
    deleteSymbolsByFile: db.prepare("DELETE FROM symbols WHERE file_id = ?"),
    insertSymbol: db.prepare(`
      INSERT INTO symbols (file_id, name, kind, container, start_line, end_line, start_byte, end_byte, exported, signature, doc)
      VALUES (@file_id, @name, @kind, @container, @start_line, @end_line, @start_byte, @end_byte, @exported, @signature, @doc)
    `),

    // edges
    countEdges: db.prepare("SELECT COUNT(*) AS n FROM edges"),
    deleteEdgesByFile: db.prepare("DELETE FROM edges WHERE src_file = ?"),
    insertEdge: db.prepare(`
      INSERT INTO edges (src_file, src_sym, dst_name, dst_file, dst_sym, kind, raw_target)
      VALUES (@src_file, @src_sym, @dst_name, @dst_file, @dst_sym, @kind, @raw_target)
    `),
    neighborsBySymbol: db.prepare(`
      SELECT DISTINCT s.id, s.name, s.kind, s.file_id
      FROM edges e
      JOIN symbols s ON (e.dst_sym = s.id OR e.src_sym = s.id)
      WHERE (e.src_sym = ? OR e.dst_sym = ?) AND s.id != ?
    `),
    resolveEdgeDst: db.prepare(`
      UPDATE edges SET dst_file = @dst_file, dst_sym = @dst_sym
      WHERE dst_name = @name AND dst_file IS NULL
    `),

    // fts
    symbolsFts: db.prepare(`
      SELECT s.id, s.file_id, s.name, s.kind, s.exported,
             bm25(symbols_fts, 1.0, 0.75, 0.5) AS bm25_score
      FROM symbols_fts
      JOIN symbols s ON symbols_fts.rowid = s.id
      WHERE symbols_fts MATCH ?
      ORDER BY bm25_score
      LIMIT ?
    `),
  };
}
