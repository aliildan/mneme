import Database from "better-sqlite3";
import { stat } from "node:fs/promises";
import { detectRoot } from "../../project/detect-root.js";
import { projectHash } from "../../project/project-hash.js";
import { projectDbPath } from "../../config/paths.js";
import { loadConfig, interpolateEnv } from "../../config/mneme-config.js";
import { listMemories } from "../../memory/recall.js";

const KIND_ORDER = { todo: 0, decision: 1, gotcha: 2, learning: 3 };
const KIND_LABELS = { todo: "Open todos", decision: "Decisions", gotcha: "Gotchas", learning: "Learnings" };

export async function sessionContext() {
  try {
    const config = await loadConfig();
    const sc = config.sessionContext ?? {};
    if (sc.enabled === false) return;

    const startDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let root;
    try { root = await detectRoot(startDir); } catch { return; }
    let hash;
    try { hash = projectHash(root); } catch { return; }

    const dbPath = projectDbPath(hash);
    try { await stat(dbPath); } catch { return; } // not indexed → silent no-op

    const includeGlobal = sc.includeGlobal === true;
    const globalDbPath = interpolateEnv(config.memory?.globalDbPath ?? "");
    const maxItems = sc.maxItems ?? 15;

    let rows = [];
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      rows = await listMemories(db, globalDbPath, {
        scope: includeGlobal ? "any" : "project",
        kind: "any",
        limit: maxItems * 4,
      });
    } finally {
      db.close();
    }

    const digest = buildSessionDigest(rows, sc);
    if (digest) process.stdout.write(digest);
  } catch {
    // Never break session start.
  }
}

export function buildSessionDigest(memories, sc = {}) {
  const kinds = sc.kinds ?? ["todo", "decision", "gotcha"];
  const budget = sc.tokenBudget ?? 800;
  const maxItems = sc.maxItems ?? 15;
  const perItemCharCap = sc.perItemCharCap ?? 280;

  const filtered = (memories ?? [])
    .filter((m) => m && typeof m.body === "string" && m.body.trim() && kinds.includes(m.kind))
    .sort((a, b) =>
      (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99) ||
      (b.created_at ?? 0) - (a.created_at ?? 0));

  const picked = [];
  let usedTokens = 0;
  for (const m of filtered) {
    if (picked.length >= maxItems) break;
    const normalizedBody = m.body.replace(/\s+/g, " ").trim();
    const tokens = Math.ceil(normalizedBody.length / 4);
    if (picked.length > 0 && usedTokens + tokens > budget) continue;
    const body = truncate(normalizedBody, perItemCharCap);
    picked.push({ kind: m.kind, body });
    usedTokens += tokens;
  }
  if (picked.length === 0) return "";

  let out = "## Project memory (mneme)\n\n";
  for (const kind of ["todo", "decision", "gotcha", "learning"]) {
    const arr = picked.filter((p) => p.kind === kind);
    if (arr.length === 0) continue;
    out += `**${KIND_LABELS[kind]}**\n`;
    for (const p of arr) out += `- ${p.body}\n`;
    out += "\n";
  }
  return out;
}

function truncate(s, cap) {
  return s.length > cap ? s.slice(0, cap - 1) + "…" : s;
}
