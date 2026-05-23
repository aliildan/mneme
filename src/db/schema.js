export const SCHEMA_VERSION = 1;

export const DDL_V1 = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY,
  rel_path     TEXT NOT NULL UNIQUE,
  language     TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  mtime_ms     INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  parsed_at    INTEGER NOT NULL DEFAULT 0,
  parse_ok     INTEGER NOT NULL DEFAULT 0,
  parse_error  TEXT
);
CREATE INDEX IF NOT EXISTS files_lang ON files(language);

CREATE TABLE IF NOT EXISTS merkle_nodes (
  rel_path   TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  parent     TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS merkle_parent ON merkle_nodes(parent);

CREATE TABLE IF NOT EXISTS symbols (
  id         INTEGER PRIMARY KEY,
  file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  container  TEXT,
  start_line INTEGER NOT NULL,
  end_line   INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte   INTEGER NOT NULL,
  exported   INTEGER NOT NULL DEFAULT 0,
  signature  TEXT,
  doc        TEXT
);
CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS symbols_kind ON symbols(kind);

CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY,
  src_file   INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  src_sym    INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  dst_name   TEXT NOT NULL,
  dst_file   INTEGER REFERENCES files(id),
  dst_sym    INTEGER REFERENCES symbols(id),
  kind       TEXT NOT NULL,
  raw_target TEXT
);
CREATE INDEX IF NOT EXISTS edges_src_file ON edges(src_file);
CREATE INDEX IF NOT EXISTS edges_dst_file ON edges(dst_file);
CREATE INDEX IF NOT EXISTS edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS edges_dst_name ON edges(dst_name);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name, signature, doc,
  content='symbols', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS symbols_fts_insert AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, name, signature, doc)
  VALUES (new.id, new.name, new.signature, new.doc);
END;

CREATE TRIGGER IF NOT EXISTS symbols_fts_delete AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc)
  VALUES ('delete', old.id, old.name, old.signature, old.doc);
END;

CREATE TRIGGER IF NOT EXISTS symbols_fts_update AFTER UPDATE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, signature, doc)
  VALUES ('delete', old.id, old.name, old.signature, old.doc);
  INSERT INTO symbols_fts(rowid, name, signature, doc)
  VALUES (new.id, new.name, new.signature, new.doc);
END;
`;

// Phase 2 memory schema (applied to both index.db and global.db)
export const DDL_V2_MEMORY = `
CREATE TABLE IF NOT EXISTS memory (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL,
  body          TEXT NOT NULL,
  scope         TEXT NOT NULL,
  task          TEXT,
  files         TEXT,
  identifiers   TEXT,
  tags          TEXT,
  source        TEXT NOT NULL DEFAULT 'agent',
  superseded_by INTEGER REFERENCES memory(id),
  created_at    INTEGER NOT NULL,
  forgotten_at  INTEGER,
  last_recalled_at INTEGER,
  recall_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS memory_kind ON memory(kind);
CREATE INDEX IF NOT EXISTS memory_created ON memory(created_at);
CREATE INDEX IF NOT EXISTS memory_forgotten ON memory(forgotten_at);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  body, task, tags, identifiers, files,
  content='memory', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, body, task, tags, identifiers, files)
  VALUES (new.id, new.body, new.task, new.tags, new.identifiers, new.files);
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER UPDATE OF forgotten_at ON memory
WHEN new.forgotten_at IS NOT NULL AND old.forgotten_at IS NULL BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, body, task, tags, identifiers, files)
  VALUES ('delete', old.id, old.body, old.task, old.tags, old.identifiers, old.files);
END;
`;

// Phase 3 chunk store
export const DDL_V3_CHUNKS = `
CREATE TABLE IF NOT EXISTS chunks (
  id             INTEGER PRIMARY KEY,
  file_id        INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  symbol_id      INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  start_line     INTEGER NOT NULL,
  end_line       INTEGER NOT NULL,
  start_byte     INTEGER NOT NULL,
  end_byte       INTEGER NOT NULL,
  text_hash      TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  embedded_at    INTEGER
);
CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS chunks_symbol ON chunks(symbol_id);
`;

// Phase 4 outcomes
export const DDL_V4_OUTCOMES = `
CREATE TABLE IF NOT EXISTS retrieval_outcomes (
  id          INTEGER PRIMARY KEY,
  context_id  TEXT NOT NULL UNIQUE,
  task        TEXT NOT NULL,
  hint        TEXT,
  symbols     TEXT NOT NULL,
  outcome     TEXT,
  tokens_in   INTEGER,
  tokens_used INTEGER,
  notes       TEXT,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS retrieval_outcomes_created ON retrieval_outcomes(created_at);
CREATE INDEX IF NOT EXISTS retrieval_outcomes_outcome ON retrieval_outcomes(outcome);
`;
