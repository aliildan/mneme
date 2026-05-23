// Phase 3 hybrid ranker (BM25 + vector via sqlite-vec, fused with RRF).
// Not yet wired into the MCP get_context path — invoked only when an `embed`
// function is supplied by the caller. See CLAUDE.md for the phased roadmap.

import { rankSymbols } from "./rank.js";
import { packContext } from "./budget.js";
import { log } from "../util/logger.js";

// Reciprocal Rank Fusion — combines BM25 + vector ranks without score normalization.
function rrfMerge(listA, listB, k = 60) {
  const scores = new Map();

  function addRank(list) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id ?? list[i].chunk_id;
      const rrf = 1 / (k + i + 1);
      scores.set(id, (scores.get(id) ?? 0) + rrf);
    }
  }

  addRank(listA);
  addRank(listB);

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score, reasons: ["rrf"] }));
}

// Phase 3 hybrid retrieval: BM25 + vector over chunks + RRF.
export async function rankHybrid(db, projectRoot, { task, hint, tokenBudget = 6000, perFileCap = 800, weights = {}, embed } = {}) {
  // BM25 pass (Phase 1 ranker)
  const bm25 = rankSymbols(db, task, hint, { weights });

  let fused = bm25;

  if (embed) {
    try {
      // Vector pass over chunk_embeddings (requires sqlite-vec)
      const qEmb = await embed(task + (hint ? " " + hint : ""));
      const vecResults = db.prepare(`
        SELECT chunk_id, distance FROM chunk_embeddings
        WHERE embedding MATCH ? AND k = 100
        ORDER BY distance
      `).all(serializeEmbedding(qEmb));

      // Map chunk_id → symbol_id for RRF merge
      const chunkToSym = new Map();
      for (const r of vecResults) {
        const chunk = db.prepare("SELECT symbol_id FROM chunks WHERE id = ?").get(r.chunk_id);
        if (chunk?.symbol_id) chunkToSym.set(r.chunk_id, { id: chunk.symbol_id });
      }

      const vecBySymbol = vecResults
        .filter((r) => chunkToSym.has(r.chunk_id))
        .map((r) => ({ id: chunkToSym.get(r.chunk_id).id, distance: r.distance }));

      fused = rrfMerge(bm25, vecBySymbol);
    } catch (err) {
      log.warn(`Vector search failed, using BM25 only: ${err.message}`);
    }
  }

  return packContext(fused, db, projectRoot, tokenBudget, perFileCap);
}

function serializeEmbedding(embedding) {
  // sqlite-vec expects a Float32Array or Uint8Array of the embedding bytes
  const arr = new Float32Array(embedding);
  return Buffer.from(arr.buffer);
}
