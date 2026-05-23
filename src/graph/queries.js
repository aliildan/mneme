// N-hop dependency graph traversal using recursive CTEs over the edges table.

export function queryGraph(db, symbolName, filePath, hops, direction) {
  // Find the starting symbol
  let symQuery = "SELECT s.id, s.name, f.rel_path FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.name = ?";
  const params = [symbolName];
  if (filePath) { symQuery += " AND f.rel_path LIKE ?"; params.push(`%${filePath}%`); }
  symQuery += " LIMIT 1";

  const start = db.prepare(symQuery).get(...params);
  if (!start) return [];

  // Recursive CTE for N-hop traversal
  const isCallers = direction === "callers";
  const srcCol = isCallers ? "dst_sym" : "src_sym";
  const dstCol = isCallers ? "src_sym" : "dst_sym";

  try {
    const rows = db.prepare(`
      WITH RECURSIVE graph(sym_id, name, file, path, depth) AS (
        SELECT ?, ?, ?, ?, 0
        UNION ALL
        SELECT e.${dstCol}, s.name, f.rel_path,
               graph.path || '<-' || s.name,
               graph.depth + 1
        FROM edges e
        JOIN symbols s ON e.${dstCol} = s.id
        JOIN files f ON s.file_id = f.id
        JOIN graph ON e.${srcCol} = graph.sym_id
        WHERE graph.depth < ?
          AND e.kind IN ('calls', 'imports')
          AND e.${dstCol} IS NOT NULL
      )
      SELECT DISTINCT sym_id, name, file, path FROM graph WHERE depth > 0
      ORDER BY depth, name
    `).all(start.id, start.name, start.rel_path, start.name, hops);

    return rows.map((r) => {
      // Find line numbers for this symbol
      const sym = db.prepare("SELECT start_line, end_line FROM symbols WHERE id = ?").get(r.sym_id);
      return {
        name: r.name,
        file: r.file,
        lines: sym ? [sym.start_line, sym.end_line] : null,
        path: r.path.split("<-").filter(Boolean),
      };
    });
  } catch (err) {
    throw new Error(`graph query failed (direction=${direction}, hops=${hops}): ${err.message}`);
  }
}
