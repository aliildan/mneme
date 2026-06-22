const KIND_ORDER = { todo: 0, decision: 1, gotcha: 2, learning: 3 };
const KIND_LABELS = { todo: "Open todos", decision: "Decisions", gotcha: "Gotchas", learning: "Learnings" };

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
    if (!normalizedBody) continue;
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
