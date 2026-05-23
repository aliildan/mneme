import { getStmts } from "../db/statements.js";

const SYSTEM_PROMPT = `You are a relevance filter for a code-context engine. You will receive a TASK and a numbered list of CANDIDATE symbols (name, kind, file, one-line signature).
Return ONLY a JSON object of the form:
  {"keep":[<integer indices>], "drop":[<integer indices>]}
Every candidate index must appear in exactly one list. No prose. No code fences.
If unsure about a candidate, KEEP it. Your job is to remove obvious non-matches, not to decide the final answer.`;

export function buildDiscoveryPrompt(ranked, db, { task, hint }) {
  const stmts = getStmts(db);
  const lines = [];

  for (let i = 0; i < ranked.length; i++) {
    const sym = stmts.symbolById.get(ranked[i].id);
    if (!sym) continue;
    const file = stmts.getFileById.get(sym.file_id);
    const filePath = file?.rel_path ?? "?";
    const sig = sym.signature ? sym.signature.slice(0, 100) : "";
    lines.push(`${i + 1}. ${sym.name} (${sym.kind}) ${filePath}:${sym.start_line}-${sym.end_line}`);
    if (sig) lines.push(`   ${sig}`);
  }

  const userContent = [
    `TASK: ${task}`,
    `HINT: ${hint ?? "(none)"}`,
    "",
    "CANDIDATES:",
    ...lines,
  ].join("\n");

  return { system: SYSTEM_PROMPT, userContent };
}

export function parseDiscoveryResponse(text, totalCandidates) {
  try {
    // Extract JSON from code fences if model wraps response
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const cleaned = (fenceMatch ? fenceMatch[1] : text).trim();
    const obj = JSON.parse(cleaned);
    if (!Array.isArray(obj.keep) || !Array.isArray(obj.drop)) throw new Error("bad shape");

    // Validate: every index 1..N appears exactly once
    const all = new Set([...obj.keep, ...obj.drop]);
    for (let i = 1; i <= totalCandidates; i++) {
      if (!all.has(i)) throw new Error(`missing index ${i}`);
    }

    return { keep: obj.keep, drop: obj.drop, ok: true };
  } catch (err) {
    return { keep: null, drop: null, ok: false, error: err.message };
  }
}
