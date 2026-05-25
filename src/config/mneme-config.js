import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { OPENCLAUDE_HOME } from "./paths.js";

const CONFIG_FILE = join(OPENCLAUDE_HOME, "mneme.json");

const DEFAULT_CONFIG = {
  discoveryModel: null,
  router: { baseUrl: "http://127.0.0.1:11436" },
  indexer: {
    maxFileBytes: 1048576,
    ignore: [".git", "node_modules", "dist", "build", ".next", ".venv", "target", ".mneme"],
    languages: ["typescript", "python", "go", "rust", "php", "csharp"],
  },
  retrieval: {
    defaultTokenBudget: 6000,
    perFileCap: 800,
    tokenizer: "chars/4",
    weights: { nameMatch: 1.0, pathToken: 0.3, hintFile: 0.8, graphHop: 0.4, recency: 0.2, exported: 0.1 },
  },
  memory: { globalDbPath: "$HOME/.openclaude/mneme/global.db" },
};

export const configPaths = { dir: OPENCLAUDE_HOME, file: CONFIG_FILE };

export async function ensureConfig() {
  try { await stat(CONFIG_FILE); } catch {
    await mkdir(OPENCLAUDE_HOME, { recursive: true });
    await writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  }
  return CONFIG_FILE;
}

export async function loadConfig() {
  await ensureConfig();
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return mergeDeep(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(cfg) {
  await ensureConfig();
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

export function interpolateEnv(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => process.env[name] ?? "")
    .replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => process.env[name] ?? "");
}

function mergeDeep(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override ?? {})) {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object") {
      out[k] = mergeDeep(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}
