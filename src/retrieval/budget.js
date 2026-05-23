import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { estimateTokens } from "../util/token-estimate.js";
import { getStmts } from "../db/statements.js";

export async function packContext(ranked, db, projectRoot, budget, perFileCap) {
  const stmts = getStmts(db);
  const out = { symbols: [], snippets: [], token_estimate: 0 };
  const perFileUsed = new Map(); // fileId → tokens used
  let used = 0;

  // Cache file content in memory to avoid re-reading the same file multiple times
  const fileContentCache = new Map();

  for (const r of ranked) {
    const sym = stmts.symbolById.get(r.id);
    if (!sym) continue;

    const file = stmts.getFileById.get(sym.file_id);
    if (!file) continue;

    const absPath = join(projectRoot, file.rel_path);
    let content;
    try {
      if (!fileContentCache.has(file.rel_path)) {
        fileContentCache.set(file.rel_path, await readFile(absPath, "utf8"));
      }
      content = fileContentCache.get(file.rel_path);
    } catch { continue; }

    // Extract the slice for this symbol
    const lines = content.split("\n");
    const startLine = sym.start_line - 1; // 0-indexed
    const endLine = sym.end_line; // exclusive
    const snippet = lines.slice(startLine, endLine).join("\n");

    const t = estimateTokens(snippet);
    const fileT = perFileUsed.get(sym.file_id) ?? 0;

    if (fileT + t > perFileCap) continue;
    if (used + t > budget) break;

    out.symbols.push({
      name: sym.name,
      kind: sym.kind,
      file: file.rel_path,
      lines: [sym.start_line, sym.end_line],
      reasons: r.reasons,
      exported: !!sym.exported,
      signature: sym.signature ?? null,
    });
    out.snippets.push({
      file: file.rel_path,
      start: sym.start_line,
      end: sym.end_line,
      text: snippet,
    });

    used += t;
    perFileUsed.set(sym.file_id, fileT + t);
  }

  out.token_estimate = used;
  return out;
}
