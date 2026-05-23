export async function lookupSymbol(db, projectRoot, { name, kind = "any", limit = 20 } = {}) {
  let query = "SELECT s.*, f.rel_path FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.name LIKE ?";
  const params = [`%${name}%`];
  if (kind !== "any") {
    query += " AND s.kind = ?";
    params.push(kind);
  }
  query += " LIMIT ?";
  params.push(limit);

  const rows = db.prepare(query).all(...params);
  return rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    file: r.rel_path,
    lines: [r.start_line, r.end_line],
    signature: r.signature ?? null,
    exported: !!r.exported,
    container: r.container ?? null,
  }));
}
