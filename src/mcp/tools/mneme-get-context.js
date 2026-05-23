import { getStmts } from "../../db/statements.js";
import { runDiscovery } from "../../retrieval/discovery-runner.js";
import { rankSymbols } from "../../retrieval/rank.js";
import { packContext } from "../../retrieval/budget.js";
import { randomUUID } from "node:crypto";
import { log } from "../../util/logger.js";

// Response layout: stable content first (deterministic given file state + config),
// volatile metadata last so consumers can key prompt caches on the stable prefix.
export async function handleGetContext(args, { db, projectRoot, config, validation }) {
  const { task, hint, token_budget, use_discovery_model = true } = args;
  const budget = token_budget ?? config.retrieval?.defaultTokenBudget ?? 6000;
  const perFileCap = config.retrieval?.perFileCap ?? 800;
  const weights = config.retrieval?.weights ?? {};

  const stmts = getStmts(db);
  const t0 = Date.now();

  let ranked = rankSymbols(db, task, hint, { weights });

  let fallbackReason = null;
  if (use_discovery_model && config.discoveryModel) {
    try {
      ranked = await runDiscovery(ranked, db, { task, hint, model: config.discoveryModel, config });
    } catch (err) {
      fallbackReason = `discovery-model-unavailable: ${err.message}`;
      log.warn(`Discovery model failed, using deterministic ranking: ${err.message}`);
    }
  } else if (!config.discoveryModel) {
    fallbackReason = "no-discovery-model-configured";
  }

  const packed = await packContext(ranked, db, projectRoot, budget, perFileCap);

  const contextId = randomUUID();
  try {
    const outcomesTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='retrieval_outcomes'"
    ).get();
    if (outcomesTable) {
      db.prepare(`
        INSERT INTO retrieval_outcomes (context_id, task, hint, symbols, tokens_in, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        contextId,
        task,
        hint ?? null,
        JSON.stringify(packed.symbols.map((s) => ({ name: s.name, file: s.file }))),
        packed.token_estimate,
        Date.now(),
      );
    }
  } catch (err) {
    log.warn(`Failed to record outcome stub for ${contextId}: ${err.message}`);
  }

  return {
    // ── Stable content (cache-stable for unchanged inputs + file state) ──
    project_hash: stmts.getMeta.get("project_hash")?.value ?? null,
    symbols: packed.symbols,
    snippets: packed.snippets,
    token_estimate: packed.token_estimate,
    fallback_reason: fallbackReason,
    validated: {
      changed: validation?.changed ?? false,
      dirty: validation?.dirty ?? 0,
      removed: validation?.removed ?? 0,
    },
    // ── Volatile metadata (varies per call) ──
    context_id: contextId,
    took_ms: Date.now() - t0,
  };
}
