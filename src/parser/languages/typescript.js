import { extractSymbolsAndEdges } from "../ts-extract.js";

const plugin = {
  id: "typescript",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],

  async extractSymbolsAndEdges(relPath, bytes, language = "typescript") {
    return extractSymbolsAndEdges(relPath, bytes, language);
  },

  chunkBoundaries(tree, source) {
    // Phase 3: extract function/class/export chunk boundaries from the tree.
    const chunks = [];
    function walk(node) {
      const types = ["function_declaration", "class_declaration", "method_definition",
                     "arrow_function", "function_expression", "export_statement"];
      if (types.includes(node.type) && node.endIndex - node.startIndex > 50) {
        chunks.push({
          startByte: node.startIndex,
          endByte: node.endIndex,
          kind: node.type.replace("_declaration", "").replace("_definition", ""),
          name: node.childForFieldName?.("name")?.text ?? node.type,
        });
        return; // Don't recurse into chunks (no nesting)
      }
      for (let i = 0; i < node.childCount; i++) walk(node.child(i));
    }
    walk(tree.rootNode);
    return chunks;
  },
};

export default plugin;
