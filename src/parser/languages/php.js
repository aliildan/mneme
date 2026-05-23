import { getParser, getQuery } from "../tree-sitter-loader.js";

const QUERY_SOURCE = `
(function_definition name: (name) @name) @function
(method_declaration name: (name) @name) @method
(class_declaration name: (name) @name) @class
(interface_declaration name: (name) @name) @interface
(trait_declaration name: (name) @name) @class
(enum_declaration name: (name) @name) @enum
(namespace_use_clause (qualified_name) @source) @import
(namespace_use_clause (name) @source) @import
`;

function methodIsPublic(methodNode) {
  for (let i = 0; i < methodNode.childCount; i++) {
    const child = methodNode.child(i);
    if (child.type === "visibility_modifier") {
      const t = child.text;
      if (t === "private" || t === "protected") return false;
      if (t === "public") return true;
    }
    if (child.type === "function" || child.type === "name") break;
  }
  return true;
}

const plugin = {
  id: "php",
  extensions: [".php", ".phtml", ".phar"],

  async extractSymbolsAndEdges(relPath, bytes) {
    const { parser } = await getParser("php");
    const source = bytes instanceof Buffer ? bytes.toString("utf8") : Buffer.from(bytes).toString("utf8");
    let tree;
    try { tree = parser.parse(source); }
    catch (err) { return { symbols: [], edges: [], parseOk: false, parseError: err.message }; }

    const query = await getQuery("php", QUERY_SOURCE);
    const matches = query.matches(tree.rootNode);

    const symbols = [];
    const edges = [];

    for (const match of matches) {
      const mainCapture = match.captures.find((c) => ["function", "method", "class", "interface", "enum"].includes(c.name));
      const nameCapture = match.captures.find((c) => c.name === "name");
      const sourceCapture = match.captures.find((c) => c.name === "source");

      if (match.captures.some((c) => c.name === "import")) {
        if (sourceCapture) {
          const raw = sourceCapture.node.text;
          edges.push({ dst_name: raw, kind: "imports", raw_target: raw });
        }
        continue;
      }
      if (!mainCapture || !nameCapture) continue;

      const node = mainCapture.node;
      const nl = source.indexOf("\n", node.startIndex);
      const firstLine = source.slice(node.startIndex, nl < 0 ? source.length : nl);
      const exported = mainCapture.name === "method" ? (methodIsPublic(node) ? 1 : 0) : 1;

      symbols.push({
        name: nameCapture.node.text,
        kind: mainCapture.name,
        container: null,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        start_byte: node.startIndex,
        end_byte: node.endIndex,
        exported,
        signature: firstLine.slice(0, 200).trim(),
        doc: null,
      });
    }

    return { symbols, edges, parseOk: true, parseError: null };
  },

  chunkBoundaries(tree, source) {
    const chunks = [];
    function walk(node) {
      if ([
        "function_definition", "method_declaration", "class_declaration",
        "interface_declaration", "trait_declaration", "enum_declaration",
      ].includes(node.type)) {
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
