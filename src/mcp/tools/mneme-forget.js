export async function handleForgetMemory(args, { db }) {
  const { id } = args;
  const row = db.prepare("SELECT id FROM memory WHERE id = ? AND forgotten_at IS NULL").get(id);
  if (!row) throw new Error(`Memory id ${id} not found or already forgotten`);
  db.prepare("UPDATE memory SET forgotten_at = ? WHERE id = ?").run(Date.now(), id);
  return { ok: true, forgotten_id: id };
}
