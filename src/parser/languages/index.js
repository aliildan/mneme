import pythonPlugin from "./python.js";
import goPlugin from "./go.js";
import rustPlugin from "./rust.js";
import phpPlugin from "./php.js";
import csharpPlugin from "./csharp.js";

export const PLUGINS = {
  python: pythonPlugin,
  go: goPlugin,
  rust: rustPlugin,
  php: phpPlugin,
  csharp: csharpPlugin,
};

export function getPlugin(language) {
  return PLUGINS[language] ?? null;
}
