import Database from "better-sqlite3";
import { ensureProjectDir, ensureMnemeHome } from "../config/paths.js";

const dbCache = new Map();

export async function openProjectDb(projectHash, dbPath) {
  if (dbCache.has(dbPath)) return dbCache.get(dbPath);
  await ensureProjectDir(projectHash);
  const db = openDb(dbPath);
  dbCache.set(dbPath, db);
  return db;
}

export async function openGlobalDb(dbPath) {
  if (dbCache.has(dbPath)) return dbCache.get(dbPath);
  await ensureMnemeHome();
  const db = openDb(dbPath);
  dbCache.set(dbPath, db);
  return db;
}

function openDb(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -8000"); // 8 MB page cache
  return db;
}

export function closeDb(dbPath) {
  const db = dbCache.get(dbPath);
  if (db) { db.close(); dbCache.delete(dbPath); }
}
