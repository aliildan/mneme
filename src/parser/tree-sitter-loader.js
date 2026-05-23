import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { log } from "../util/logger.js";

const require = createRequire(import.meta.url);

let tsPromise = null;
const parsers = new Map();
const queries = new Map();

async function getTreeSitter() {
  if (tsPromise) return tsPromise;
  tsPromise = (async () => {
    const Parser = (await import("web-tree-sitter")).default;
    await Parser.init();
    return Parser;
  })();
  return tsPromise;
}

function resolveWasm(langId) {
  // tree-sitter-wasms ships prebuilt WASM files under out/
  try {
    return require.resolve(`tree-sitter-wasms/out/tree-sitter-${langId}.wasm`);
  } catch {
    // Fallback: try vendor/ directory
    const __dir = dirname(fileURLToPath(import.meta.url));
    return join(__dir, "../../vendor", `tree-sitter-${langId}.wasm`);
  }
}

export async function getParser(langId) {
  if (parsers.has(langId)) return parsers.get(langId);

  const Parser = await getTreeSitter();
  const wasmPath = resolveWasm(langId);

  try {
    const lang = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    parsers.set(langId, { parser, lang });
    log.info(`Loaded tree-sitter grammar: ${langId} from ${wasmPath}`);
    return parsers.get(langId);
  } catch (err) {
    log.error(`Failed to load grammar ${langId}: ${err.message}`);
    throw err;
  }
}

export async function getQuery(langId, querySource) {
  const key = `${langId}:${querySource.length}`;
  if (queries.has(key)) return queries.get(key);

  const { lang } = await getParser(langId);
  const query = lang.query(querySource);
  queries.set(key, query);
  return query;
}

// Map file language string to tree-sitter grammar id
export function langToGrammarId(language) {
  if (language === "typescript") return "typescript";
  if (language === "javascript") return "javascript";
  if (language === "python") return "python";
  if (language === "go") return "go";
  if (language === "rust") return "rust";
  if (language === "php") return "php";
  if (language === "csharp") return "c_sharp";
  return null;
}
