export async function handleRecordOutcome(args, { db }) {
  const { context_id, outcome, notes, tokens_used } = args;

  const existing = db.prepare(
    "SELECT id FROM retrieval_outcomes WHERE context_id = ?"
  ).get(context_id);

  if (!existing) {
    throw new Error(`No context found for context_id: ${context_id}. Was it returned by mneme_get_context?`);
  }

  db.prepare(`
    UPDATE retrieval_outcomes
    SET outcome = ?, notes = ?, tokens_used = ?, resolved_at = ?
    WHERE context_id = ?
  `).run(outcome, notes ?? null, tokens_used ?? null, Date.now(), context_id);

  return { ok: true, context_id, outcome };
}
