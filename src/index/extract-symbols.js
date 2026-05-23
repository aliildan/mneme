import { readFile } from "node:fs/promises";
import { extractSymbolsAndEdges } from "../parser/ts-extract.js";
import { getPlugin } from "../parser/languages/index.js";
import { log } from "../util/logger.js";

export async function extractFromFile(absPath, relPath, language) {
  if (language === "unknown") {
    return { symbols: [], edges: [], parseOk: true, parseError: null };
  }

  let bytes;
  try {
    bytes = await readFile(absPath);
  } catch (err) {
    log.warn(`Cannot read ${relPath}: ${err.message}`);
    return { symbols: [], edges: [], parseOk: false, parseError: err.message };
  }

  if (language === "typescript" || language === "javascript") {
    return extractSymbolsAndEdges(relPath, bytes, language);
  }

  const plugin = getPlugin(language);
  if (!plugin) {
    log.warn(`No plugin registered for language: ${language}`);
    return { symbols: [], edges: [], parseOk: true, parseError: null };
  }

  try {
    return await plugin.extractSymbolsAndEdges(relPath, bytes);
  } catch (err) {
    log.warn(`Plugin ${language} failed on ${relPath}: ${err.message}`);
    return { symbols: [], edges: [], parseOk: false, parseError: err.message };
  }
}
