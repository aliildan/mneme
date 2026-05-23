import { readFile, stat, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { hashFileContent } from "../fs/content-hash.js";
import { validateLazily, persistMerkle } from "../fs/merkle.js";
import { detectLanguage } from "../fs/walker.js";
import { extractFromFile } from "./extract-symbols.js";
import { upsertFile, replaceSymbolsForFile, replaceEdgesForFile, resolveEdges, deleteFileCascade } from "./index-writer.js";
import { getStmts } from "../db/statements.js";
import { log } from "../util/logger.js";

const DEBOUNCE_MS = 250;
const lastValidated = new Map(); // dbPath → timestamp

export async function ensureFresh(db, projectRoot, options = {}) {
  const dbPath = db.name;
  const now = Date.now();

  // PostToolUse hooks drop a `.dirty` marker next to the DB to force a fresh
  // walk on the next call (bypassing the debounce). Detect and consume it.
  const dirtyPath = join(dirname(dbPath), ".dirty");
  let forceFresh = false;
  try { await stat(dirtyPath); forceFresh = true; } catch {}

  // Debounce: skip if validated very recently AND no dirty marker present
  if (!forceFresh && now - (lastValidated.get(dbPath) ?? 0) < DEBOUNCE_MS) {
    return { changed: false, skipped: true };
  }

  const cfg = options.config ?? {};
  const maxFileBytes = cfg.indexer?.maxFileBytes ?? 1048576;
  const extraIgnore = cfg.indexer?.ignore ?? [];

  const t0 = Date.now();
  const stmts = getStmts(db);

  const { dirty, removed, newRootHash, newHashes } = await validateLazily(db, projectRoot, {
    maxFileBytes,
    ignore: extraIgnore,
  });

  const cachedRoot = stmts.getMerkleRoot.get()?.hash ?? null;

  if (newRootHash === cachedRoot && dirty.size === 0 && removed.size === 0) {
    lastValidated.set(dbPath, now);
    if (forceFresh) await unlink(dirtyPath).catch(() => {});
    return { changed: false };
  }

  // ── Phase 1: Async extraction for all dirty files ───────────────────────────
  // Must happen BEFORE the transaction since web-tree-sitter is async.
  const fileData = new Map(); // relPath → { info, bytes, contentHash, language, symbols, edges, parseOk, parseError }

  for (const relPath of dirty) {
    const absPath = join(projectRoot, relPath);
    try {
      const info = await stat(absPath);
      if (info.size > maxFileBytes) continue;
      const bytes = await readFile(absPath);
      const contentHash = hashFileContent(relPath, bytes);
      const language = detectLanguage(relPath);
      const extracted = await extractFromFile(absPath, relPath, language);
      fileData.set(relPath, {
        info,
        contentHash,
        language,
        sizeBytes: info.size,
        mtimeMs: Math.floor(info.mtimeMs),
        ...extracted,
      });
    } catch (err) {
      log.warn(`Cannot process ${relPath}: ${err.message}`);
    }
  }

  // ── Phase 2: Single synchronous transaction ──────────────────────────────────
  db.transaction(() => {
    for (const rel of removed) deleteFileCascade(db, rel);

    for (const [relPath, data] of fileData) {
      const file = upsertFile(db, {
        relPath,
        language: data.language,
        sizeBytes: data.sizeBytes,
        mtimeMs: data.mtimeMs,
        contentHash: data.contentHash,
        parsedAt: Date.now(),
        parseOk: data.parseOk,
        parseError: data.parseError,
      });
      replaceSymbolsForFile(db, file.id, data.symbols);
      replaceEdgesForFile(db, file.id, data.edges);
    }

    persistMerkle(db, newHashes, [...removed], Date.now());
    stmts.setMeta.run("merkle_root", newRootHash);
    stmts.setMeta.run("last_validated_at", String(Date.now()));
  })();

  // ── Phase 3: Resolve edges (second pass, outside transaction) ────────────────
  if (fileData.size > 0) resolveEdges(db);

  lastValidated.set(dbPath, Date.now());
  if (forceFresh) await unlink(dirtyPath).catch(() => {});
  const tookMs = Date.now() - t0;
  log.info(`Validated in ${tookMs}ms — dirty:${dirty.size} removed:${removed.size}`);
  return { changed: true, dirty: dirty.size, removed: removed.size, tookMs };
}

// Full reindex: clear merkle cache and walk everything.
export async function fullReindex(db, projectRoot, config = {}) {
  db.exec("DELETE FROM merkle_nodes");
  getStmts(db).setMeta.run("merkle_root", "");
  // Force debounce bypass
  lastValidated.delete(db.name);
  return ensureFresh(db, projectRoot, { config });
}
