import { getParser, getQuery } from "../tree-sitter-loader.js";

const QUERY_SOURCE = `
(function_item name: (identifier) @name) @function
(impl_item type: (type_identifier) @name) @class
(struct_item name: (type_identifier) @name) @class
(enum_item name: (type_identifier) @name) @enum
(trait_item name: (type_identifier) @name) @interface
(use_declaration argument: (_) @source) @import
`;

const plugin = {
  id: "rust",
  extensions: [".rs"],

  async extractSymbolsAndEdges(relPath, bytes) {
    const { parser } = await getParser("rust");
    const source = bytes instanceof Buffer ? bytes.toString("utf8") : Buffer.from(bytes).toString("utf8");
    let tree;
    try { tree = parser.parse(source); }
    catch (err) { return { symbols: [], edges: [], parseOk: false, parseError: err.message }; }

    const query = await getQuery("rust", QUERY_SOURCE);
    const matches = query.matches(tree.rootNode);

    const symbols = [];
    const edges = [];

    for (const match of matches) {
      const mainCapture = match.captures.find((c) => ["function", "class", "enum", "interface"].includes(c.name));
      const nameCapture = match.captures.find((c) => c.name === "name");
      const sourceCapture = match.captures.find((c) => c.name === "source");

      if (match.captures.some((c) => c.name === "import")) {
        if (sourceCapture) edges.push({ dst_name: sourceCapture.node.text, kind: "imports", raw_target: sourceCapture.node.text });
        continue;
      }
      if (!mainCapture || !nameCapture) continue;

      const node = mainCapture.node;
      const isPublic = source.slice(node.startIndex, node.startIndex + 4).startsWith("pub");
      const firstLine = source.slice(node.startIndex, source.indexOf("\n", node.startIndex));

      symbols.push({
        name: nameCapture.node.text,
        kind: mainCapture.name,
        container: null,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        start_byte: node.startIndex,
        end_byte: node.endIndex,
        exported: isPublic ? 1 : 0,
        signature: firstLine.slice(0, 200).trim(),
        doc: null,
      });
    }

    return { symbols, edges, parseOk: true, parseError: null };
  },

  chunkBoundaries(tree, source) {
    const chunks = [];
    function walk(node) {
      if (["function_item", "impl_item", "struct_item", "enum_item", "trait_item"].includes(node.type)) {
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
