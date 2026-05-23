import { loadConfig } from "../config/mneme-config.js";

// Opus deliberately excluded as a discovery model per spec.
const OPUS_PREFIX = "claude-opus-";

const ANTHROPIC_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
];

const MODEL_CACHE_TTL_MS = 30_000;
let cache = null;

export function invalidateModelCache() { cache = null; }

export async function listModels({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < MODEL_CACHE_TTL_MS) {
    return cache.entries;
  }

  const config = await loadConfig();
  const baseUrl = config.router?.baseUrl ?? "http://127.0.0.1:11436";
  const entries = [];

  // Fetch Ollama models from the openclaude router's /v1/models
  try {
    const res = await fetch(new URL("/v1/models", baseUrl), {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const json = await res.json();
      for (const m of json.data ?? []) {
        if (!m.id.startsWith("claude-ol-")) continue;
        // Strip the "claude-ol-" prefix to get the real provider:modelId
        const target = m.id.slice("claude-ol-".length);
        if (target.startsWith(OPUS_PREFIX)) continue;
        entries.push({
          id: target,
          label: m.display_name ?? target,
          provider: "ollama",
        });
      }
    }
  } catch {}

  // Add curated Anthropic models (excluding Opus)
  for (const m of ANTHROPIC_MODELS) {
    if (!m.id.startsWith(OPUS_PREFIX)) {
      entries.push({ ...m, warning: "uses your Anthropic subscription" });
    }
  }

  cache = { at: Date.now(), entries };
  return entries;
}

export function isOpus(modelId) {
  return modelId?.startsWith(OPUS_PREFIX) ?? false;
}
