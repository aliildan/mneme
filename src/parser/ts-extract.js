import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { getParser, getQuery } from "./tree-sitter-loader.js";
import { log } from "../util/logger.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const QUERY_PATH = join(__dir, "queries", "typescript.scm");

let querySource = null;
async function loadQuerySource() {
  if (!querySource) querySource = await readFile(QUERY_PATH, "utf8");
  return querySource;
}

const KIND_MAP = {
  function: "function",
  const_fn: "function",
  class: "class",
  method: "method",
  interface: "interface",
  type_alias: "type",
  enum: "enum",
  default_export: "default-export",
};

export async function extractSymbolsAndEdges(relPath, fileBytes, language = "typescript") {
  const grammarId = language === "javascript" ? "javascript" : "typescript";
  const { parser } = await getParser(grammarId);
  const src = loadQuerySource();

  const source = fileBytes instanceof Buffer ? fileBytes : Buffer.from(fileBytes);
  const sourceText = source.toString("utf8");

  let tree;
  try {
    tree = parser.parse(sourceText);
  } catch (err) {
    log.warn(`Parse error in ${relPath}: ${err.message}`);
    return { symbols: [], edges: [], parseOk: false, parseError: err.message };
  }

  const query = await getQuery(grammarId, await src);
  const matches = query.matches(tree.rootNode);

  const symbols = [];
  const edges = [];
  const namesSeen = new Set();

  for (const match of matches) {
    const patternName = getPatternName(match);
    if (!patternName || patternName === "import" || patternName === "default_export") {
      // Handle imports as edges
      if (patternName === "import") {
        const sourceCapture = match.captures.find((c) => c.name === "source");
        if (sourceCapture) {
          edges.push({
            dst_name: sourceCapture.node.text,
            kind: "imports",
            raw_target: sourceCapture.node.text,
            src_sym: null,
          });
        }
      }
      continue;
    }

    const kind = KIND_MAP[patternName];
    if (!kind) continue;

    const nameCapture = match.captures.find((c) => c.name === "name");
    if (!nameCapture) continue;

    const name = nameCapture.node.text;
    const mainCapture = match.captures.find((c) => c.name === patternName) || match.captures[0];
    const node = mainCapture.node;

    // Find container (parent class for methods)
    let container = null;
    if (kind === "method") {
      let parent = node.parent;
      while (parent) {
        if (parent.type === "class_declaration" || parent.type === "class_body") {
          const classNameNode = parent.childForFieldName?.("name") ||
            parent.parent?.childForFieldName?.("name");
          if (classNameNode) { container = classNameNode.text; break; }
        }
        parent = parent.parent;
      }
    }

    // Extract JSDoc/comment immediately before the node
    const doc = extractLeadingDoc(node, sourceText);

    // First line of the definition as signature
    const startByte = node.startIndex;
    const endByte = node.endIndex;
    const firstLine = sourceText.slice(startByte, sourceText.indexOf("\n", startByte));
    const signature = firstLine.slice(0, 200).trim();

    // Is it exported?
    const exported = isExported(node) ? 1 : 0;

    const key = `${kind}:${name}:${node.startPosition.row}`;
    if (namesSeen.has(key)) continue;
    namesSeen.add(key);

    symbols.push({
      name,
      kind,
      container,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      start_byte: startByte,
      end_byte: endByte,
      exported,
      signature,
      doc,
    });
  }

  return { symbols, edges, parseOk: true, parseError: null };
}

function getPatternName(match) {
  // The pattern index maps to capture names — find the "main" capture
  for (const cap of match.captures) {
    const n = cap.name;
    if (n && n !== "name" && n !== "params" && n !== "return_type" && n !== "source" && n !== "value") {
      return n;
    }
  }
  return null;
}

function isExported(node) {
  let cur = node.parent;
  while (cur) {
    if (cur.type === "export_statement") return true;
    // Only walk up one level (we don't want to traverse far)
    if (["program", "module", "statement_block"].includes(cur.type)) break;
    cur = cur.parent;
  }
  return false;
}

function extractLeadingDoc(node, source) {
  const start = node.startIndex;
  // Look backwards for a comment block
  const before = source.slice(Math.max(0, start - 500), start);
  const jsdocMatch = before.match(/\/\*\*[\s\S]*?\*\/\s*$/);
  if (jsdocMatch) return jsdocMatch[0].trim().slice(0, 2000);
  const lineComment = before.match(/(\/\/[^\n]*\n\s*)+\s*$/);
  if (lineComment) return lineComment[0].trim().slice(0, 500);
  return null;
}
