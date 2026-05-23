import { getParser, getQuery } from "../tree-sitter-loader.js";

const QUERY_SOURCE = `
(function_declaration name: (identifier) @name) @function
(method_declaration name: (field_identifier) @name) @method
(type_declaration (type_spec name: (type_identifier) @name)) @type_alias
(short_var_declaration left: (expression_list (identifier) @name)) @const
(import_spec path: (interpreted_string_literal) @source) @import
`;

const plugin = {
  id: "go",
  extensions: [".go"],

  async extractSymbolsAndEdges(relPath, bytes) {
    const { parser } = await getParser("go");
    const source = bytes instanceof Buffer ? bytes.toString("utf8") : Buffer.from(bytes).toString("utf8");
    let tree;
    try { tree = parser.parse(source); }
    catch (err) { return { symbols: [], edges: [], parseOk: false, parseError: err.message }; }

    const query = await getQuery("go", QUERY_SOURCE);
    const matches = query.matches(tree.rootNode);

    const symbols = [];
    const edges = [];

    for (const match of matches) {
      const mainCapture = match.captures.find((c) => ["function", "method", "type_alias", "const"].includes(c.name));
      const nameCapture = match.captures.find((c) => c.name === "name");
      const sourceCapture = match.captures.find((c) => c.name === "source");

      if (match.captures.some((c) => c.name === "import")) {
        if (sourceCapture) {
          const raw = sourceCapture.node.text.replace(/"/g, "");
          edges.push({ dst_name: raw, kind: "imports", raw_target: raw });
        }
        continue;
      }
      if (!mainCapture || !nameCapture) continue;

      const node = mainCapture.node;
      const firstLine = source.slice(node.startIndex, source.indexOf("\n", node.startIndex));
      symbols.push({
        name: nameCapture.node.text,
        kind: mainCapture.name,
        container: null,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        start_byte: node.startIndex,
        end_byte: node.endIndex,
        exported: nameCapture.node.text[0] === nameCapture.node.text[0].toUpperCase() ? 1 : 0,
        signature: firstLine.slice(0, 200).trim(),
        doc: null,
      });
    }

    return { symbols, edges, parseOk: true, parseError: null };
  },

  chunkBoundaries(tree, source) {
    const chunks = [];
    function walk(node) {
      if (["function_declaration", "method_declaration", "type_declaration"].includes(node.type)) {
        chunks.push({ startByte: node.startIndex, endByte: node.endIndex, kind: "function", name: "?" });
        return;
      }
      for (let i = 0; i < node.childCount; i++) walk(node.child(i));
    }
    walk(tree.rootNode);
    return chunks;
  },
};

export default plugin;
