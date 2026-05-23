import { getParser, getQuery } from "../tree-sitter-loader.js";

const QUERY_SOURCE = `
(class_declaration name: (identifier) @name) @class
(interface_declaration name: (identifier) @name) @interface
(struct_declaration name: (identifier) @name) @class
(enum_declaration name: (identifier) @name) @enum
(record_declaration name: (identifier) @name) @class
(method_declaration name: (identifier) @name) @method
(using_directive (qualified_name) @source) @import
(using_directive (identifier) @source) @import
`;

function isPublic(node) {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c.type === "modifier") {
      const t = c.text;
      if (t === "public") return true;
      if (t === "private" || t === "protected" || t === "internal") return false;
      continue;
    }
    if ([
      "identifier", "predefined_type", "generic_name", "qualified_name",
      "parameter_list", "type_parameter_list",
    ].includes(c.type)) break;
  }
  let parent = node.parent;
  while (parent && parent.type === "declaration_list") parent = parent.parent;
  if (parent?.type === "interface_declaration") return true;
  return false;
}

const plugin = {
  id: "csharp",
  extensions: [".cs"],

  async extractSymbolsAndEdges(relPath, bytes) {
    const { parser } = await getParser("c_sharp");
    const source = bytes instanceof Buffer ? bytes.toString("utf8") : Buffer.from(bytes).toString("utf8");
    let tree;
    try { tree = parser.parse(source); }
    catch (err) { return { symbols: [], edges: [], parseOk: false, parseError: err.message }; }

    const query = await getQuery("c_sharp", QUERY_SOURCE);
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

      symbols.push({
        name: nameCapture.node.text,
        kind: mainCapture.name,
        container: null,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        start_byte: node.startIndex,
        end_byte: node.endIndex,
        exported: isPublic(node) ? 1 : 0,
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
        "class_declaration", "interface_declaration", "struct_declaration",
        "enum_declaration", "record_declaration", "method_declaration",
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
