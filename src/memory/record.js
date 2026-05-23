import { interpolateEnv } from "../config/mneme-config.js";
import { openGlobalDb } from "../db/open.js";
import { migrateGlobalDb } from "../db/migrate.js";

export async function recordMemory(projectDb, globalDbPath, {
  kind, body, scope = "project", task, files, identifiers, tags, source = "agent"
}) {
  if (!body || !body.trim()) throw new Error("body must not be empty");
  if (!["decision", "learning", "gotcha", "todo"].includes(kind)) {
    throw new Error(`kind must be one of: decision, learning, gotcha, todo`);
  }

  let db;
  if (scope === "global") {
    const resolvedPath = interpolateEnv(globalDbPath);
    db = await openGlobalDb(resolvedPath);
    migrateGlobalDb(db);
  } else {
    db = projectDb;
  }

  const row = {
    kind,
    body,
    scope,
    task: task ?? null,
    files: files?.length ? JSON.stringify(files) : null,
    identifiers: identifiers?.length ? JSON.stringify(identifiers) : null,
    tags: tags?.length ? JSON.stringify(tags) : null,
    source,
    created_at: Date.now(),
  };

  const result = db.prepare(`
    INSERT INTO memory (kind, body, scope, task, files, identifiers, tags, source, created_at)
    VALUES (@kind, @body, @scope, @task, @files, @identifiers, @tags, @source, @created_at)
  `).run(row);

  return { id: Number(result.lastInsertRowid), scope, db_path: db.name, created_at: row.created_at };
}
