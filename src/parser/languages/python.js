import { getParser } from "../tree-sitter-loader.js";

const plugin = {
  id: "python",
  extensions: [".py", ".pyw"],

  async extractSymbolsAndEdges(relPath, bytes) {
    const { parser } = await getParser("python");
    const source = bytes instanceof Buffer ? bytes.toString("utf8") : Buffer.from(bytes).toString("utf8");
    let tree;
    try { tree = parser.parse(source); }
    catch (err) { return { symbols: [], edges: [], parseOk: false, parseError: err.message }; }

    const symbols = [];
    const edges = [];
    const containerStack = [];

    const firstLineOf = (node) => {
      const nl = source.indexOf("\n", node.startIndex);
      const end = nl < 0 ? source.length : nl;
      return source.slice(node.startIndex, end).slice(0, 200).trim();
    };

    const currentContainer = () => containerStack.length ? containerStack[containerStack.length - 1] : null;

    const emit = (node, nameNode, kind) => {
      symbols.push({
        name: nameNode.text,
        kind,
        container: currentContainer(),
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        start_byte: node.startIndex,
        end_byte: node.endIndex,
        exported: 1,
        signature: firstLineOf(node),
        doc: null,
      });
    };

    const visit = (node) => {
      switch (node.type) {
        case "import_statement": {
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child.type === "dotted_name" && child.namedChildCount > 0) {
              const first = child.namedChild(0);
              if (first?.type === "identifier") {
                edges.push({ dst_name: first.text, kind: "imports", raw_target: first.text });
              }
            } else if (child.type === "aliased_import") {
              const nameNode = child.childForFieldName("name");
              if (nameNode?.namedChildCount > 0) {
                const first = nameNode.namedChild(0);
                if (first?.type === "identifier") {
                  edges.push({ dst_name: first.text, kind: "imports", raw_target: first.text });
                }
              }
            }
          }
          return;
        }
        case "import_from_statement": {
          const module = node.childForFieldName("module_name");
          if (module) {
            edges.push({ dst_name: module.text, kind: "imports", raw_target: module.text });
          }
          return;
        }
        case "class_definition": {
          const nameNode = node.childForFieldName("name");
          if (nameNode) {
            emit(node, nameNode, "class");
            containerStack.push(nameNode.text);
            for (let i = 0; i < node.childCount; i++) visit(node.child(i));
            containerStack.pop();
            return;
          }
          break;
        }
        case "function_definition": {
          const nameNode = node.childForFieldName("name");
          if (nameNode) emit(node, nameNode, "function");
          for (let i = 0; i < node.childCount; i++) visit(node.child(i));
          return;
        }
        case "decorated_definition": {
          const def = node.childForFieldName("definition");
          if (def) {
            const nameNode = def.childForFieldName("name");
            if (nameNode) {
              const kind = def.type === "class_definition" ? "class" : "function";
              emit(node, nameNode, kind);
            }
          }
          for (let i = 0; i < node.childCount; i++) visit(node.child(i));
          return;
        }
      }
      for (let i = 0; i < node.childCount; i++) visit(node.child(i));
    };

    visit(tree.rootNode);

    return { symbols, edges, parseOk: true, parseError: null };
  },

  chunkBoundaries(tree, source) {
    const chunks = [];
    function walk(node) {
      if (["function_definition", "class_definition", "decorated_definition"].includes(node.type)) {
        chunks.push({ startByte: node.startIndex, endByte: node.endIndex, kind: node.type.split("_")[0], name: "?" });
        return;
      }
      for (let i = 0; i < node.childCount; i++) walk(node.child(i));
    }
    walk(tree.rootNode);
    return chunks;
  },
};

export default plugin;
