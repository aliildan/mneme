import { getStmts } from "../db/statements.js";
import { log } from "../util/logger.js";

// Identifier-aware tokenizer: splits on camelCase, snake_case, and spaces.
// Strips non-letter/digit characters to avoid leaking FTS5 operators or
// escape sequences (notably backslash) into the phrase queries below.
function tokenize(text) {
  if (!text) return [];
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-./\\:()[\]{}<>,"'`]+/)
    .map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length >= 2);
}

function buildFtsQuery(tokens) {
  if (!tokens.length) return '""';
  // Use prefix queries so "dispatch" matches "dispatcher"
  return tokens.map((t) => `${t}*`).join(" OR ");
}

export function rankSymbols(db, task, hint, { weights = {}, limit = 200 } = {}) {
  const stmts = getStmts(db);
  const W = {
    nameMatch: weights.nameMatch ?? 1.0,
    pathToken: weights.pathToken ?? 0.3,
    hintFile: weights.hintFile ?? 0.8,
    graphHop: weights.graphHop ?? 0.4,
    recency: weights.recency ?? 0.2,
    exported: weights.exported ?? 0.1,
  };

  const tokens = tokenize((task ?? "") + " " + (hint ?? ""));
  const scored = new Map(); // sym_id → { score, reasons }

  function add(id, delta, reason) {
    if (!scored.has(id)) scored.set(id, { score: 0, reasons: [] });
    const e = scored.get(id);
    e.score += delta;
    if (reason && !e.reasons.includes(reason)) e.reasons.push(reason);
  }

  // 1. FTS5 name+signature+doc match
  if (tokens.length) {
    const ftsQuery = buildFtsQuery(tokens);
    try {
      const ftsHits = stmts.symbolsFts.all(ftsQuery, limit);
      for (const h of ftsHits) {
        // bm25 returns negative in SQLite fts5 — negate for ascending relevance
        const score = W.nameMatch * Math.abs(h.bm25_score ?? 1);
        add(h.id, score, "name-match");
      }
    } catch (err) {
      log.warn(`rank: FTS5 query failed (${err.message}); proceeding without name-match scoring`);
    }
  }

  // 2. Path token match
  for (const t of tokens) {
    const files = stmts.filesPathLike.all(`%${t}%`);
    for (const f of files) {
      const syms = stmts.symbolsByFile.all(f.id);
      for (const s of syms) add(s.id, W.pathToken, "path-token");
    }
  }

  // 3. Hint-as-path: boost all symbols in the hinted file
  if (hint) {
    const hintNorm = hint.replace(/\\/g, "/");
    const hintFile = db.prepare(
      "SELECT id FROM files WHERE rel_path = ? OR rel_path LIKE ?"
    ).get(hintNorm, `%${hintNorm}%`);
    if (hintFile) {
      const syms = stmts.symbolsByFile.all(hintFile.id);
      for (const s of syms) add(s.id, W.hintFile, "hint-file");
    }
  }

  // 4. Dependency 1-hop from top-10 seeds
  const seeds = [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 10)
    .map(([id]) => id);

  for (const seedId of seeds) {
    const neighbors = stmts.neighborsBySymbol.all(seedId, seedId, seedId);
    for (const n of neighbors) {
      add(n.id, W.graphHop * 0.5, "graph-1hop");
    }
  }

  // 5. Recency boost + exported boost (finalize scores)
  const now = Date.now();
  const files = db.prepare("SELECT id, parsed_at FROM files").all();
  const fileParsedAt = new Map(files.map((f) => [f.id, f.parsed_at]));

  for (const [id, e] of scored) {
    const sym = stmts.symbolById.get(id);
    if (!sym) { scored.delete(id); continue; }

    const age = now - (fileParsedAt.get(sym.file_id) ?? 0);
    const ageHours = age / 3_600_000;
    const recency = W.recency * Math.max(0, 1 - ageHours / 168); // decay over 1 week
    if (recency > 0) { e.score += recency; e.reasons.push("recency"); }

    if (sym.exported) { e.score += W.exported; e.reasons.push("exported"); }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0] - b[0]) // score desc, then id asc for determinism
    .map(([id, e]) => {
      const sym = stmts.symbolById.get(id);
      return { id, name: sym?.name ?? null, kind: sym?.kind ?? null, file_id: sym?.file_id ?? null, score: e.score, reasons: e.reasons };
    });
}
