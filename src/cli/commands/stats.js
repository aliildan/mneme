import { detectRoot } from "../../project/detect-root.js";
import { projectHash } from "../../project/project-hash.js";
import { projectDbPath } from "../../config/paths.js";
import { openProjectDb } from "../../db/open.js";
import { migrateProjectDb } from "../../db/migrate.js";

export async function stats(args) {
  const root = await detectRoot();
  const hash = projectHash(root);
  const dbPath = projectDbPath(hash);

  const db = await openProjectDb(hash, dbPath);
  migrateProjectDb(db);

  const outcomesTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='retrieval_outcomes'"
  ).get();

  if (!outcomesTable) {
    console.log("No outcomes recorded yet. Use mneme_record_outcome after tasks to build metrics.");
    return;
  }

  const total = db.prepare("SELECT COUNT(*) AS n FROM retrieval_outcomes WHERE outcome IS NOT NULL").get().n;
  const success = db.prepare("SELECT COUNT(*) AS n FROM retrieval_outcomes WHERE outcome='success'").get().n;
  const failure = db.prepare("SELECT COUNT(*) AS n FROM retrieval_outcomes WHERE outcome='failure'").get().n;
  const partial = db.prepare("SELECT COUNT(*) AS n FROM retrieval_outcomes WHERE outcome='partial'").get().n;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM retrieval_outcomes WHERE outcome IS NULL").get().n;

  const medianRow = db.prepare(`
    SELECT tokens_in FROM retrieval_outcomes
    WHERE tokens_in IS NOT NULL
    ORDER BY tokens_in
    LIMIT 1 OFFSET (SELECT COUNT(*) FROM retrieval_outcomes WHERE tokens_in IS NOT NULL) / 2
  `).get();

  console.log(`Retrieval outcomes (${root}):`);
  console.log(`  Total recorded:  ${total + pending}`);
  console.log(`  Success:         ${success}`);
  console.log(`  Partial:         ${partial}`);
  console.log(`  Failure:         ${failure}`);
  console.log(`  Pending:         ${pending}`);
  console.log(`  Hit rate:        ${total ? ((success / total) * 100).toFixed(1) : "n/a"}%`);
  console.log(`  Median tokens:   ${medianRow ? medianRow.tokens_in : "n/a"}`);
}
