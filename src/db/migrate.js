import { SCHEMA_VERSION, DDL_V1, DDL_V2_MEMORY, DDL_V3_CHUNKS, DDL_V4_OUTCOMES } from "./schema.js";

// The single `meta.schema_version` counter assumes callers always apply the same
// set of optional DDLs for a given DB role. Only `migrateProjectDb` (all flags)
// and `migrateGlobalDb` (memory only) are public; do not invoke `migrateDb`
// directly with arbitrary flag combinations or you may bump the version past
// a section that hasn't been applied.
export function migrateDb(db, { withMemory = false, withChunks = false, withOutcomes = false } = {}) {
  // Check if meta table exists yet (new DB has none)
  const hasMeta = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'"
  ).get();
  const raw = hasMeta
    ? db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()
    : null;
  const current = raw ? Number(raw.value) : 0;

  if (current < 1) {
    db.exec(DDL_V1);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  }
  if (withMemory) {
    const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    if (!v || Number(v.value) < 2) {
      db.exec(DDL_V2_MEMORY);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')").run();
    }
  }
  if (withChunks) {
    const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    if (!v || Number(v.value) < 3) {
      db.exec(DDL_V3_CHUNKS);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')").run();
    }
  }
  if (withOutcomes) {
    const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    if (!v || Number(v.value) < 4) {
      db.exec(DDL_V4_OUTCOMES);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '4')").run();
    }
  }
}

export function migrateProjectDb(db) {
  migrateDb(db, { withMemory: true, withChunks: true, withOutcomes: true });
}

export function migrateGlobalDb(db) {
  migrateDb(db, { withMemory: true });
}
