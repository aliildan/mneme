import { callMessages } from "../openclaude/client.js";
import { buildDiscoveryPrompt, parseDiscoveryResponse } from "./discovery-prompt.js";
import { log } from "../util/logger.js";

const DISCOVERY_TIMEOUT_MS = 4000;
const MAX_CANDIDATES = 60;

// Narrows the ranked list using the discovery model.
// The model can only REMOVE candidates — it never adds or reorders.
// Falls back to the full ranked list on any failure.
export async function runDiscovery(ranked, db, { task, hint, model, config }) {
  if (!model || ranked.length === 0) return ranked;

  // Only send top MAX_CANDIDATES to keep the prompt small
  const candidates = ranked.slice(0, MAX_CANDIDATES);

  const { system, userContent } = buildDiscoveryPrompt(candidates, db, { task, hint });

  let response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
      response = await callMessages({
        model,
        messages: [{ role: "user", content: userContent }],
        system,
        maxTokens: 256,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`discovery model timed out after ${DISCOVERY_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  const text = response.content?.[0]?.text ?? "";
  const { keep, ok, error } = parseDiscoveryResponse(text, candidates.length);

  if (!ok) {
    log.warn(`Discovery model returned non-conforming response (${error}); using full ranked list`);
    return ranked;
  }

  // Map 1-based indices back to ranked entries (candidates are 1-indexed in the prompt)
  const kept = keep.map((i) => candidates[i - 1]).filter(Boolean);

  // Append remaining ranked items that weren't sent to the discovery model (beyond MAX_CANDIDATES)
  const tail = ranked.slice(MAX_CANDIDATES);

  log.debug(`Discovery: kept ${kept.length}/${candidates.length} candidates + ${tail.length} tail`);
  return [...kept, ...tail];
}
