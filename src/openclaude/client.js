import { loadConfig } from "../config/mneme-config.js";

export const SENTINEL = "oc-discovery-sentinel-do-not-store";

export async function callMessages({ model, messages, system, maxTokens, signal }) {
  const config = await loadConfig();
  const baseUrl = config.router?.baseUrl ?? "http://127.0.0.1:11436";

  const res = await fetch(new URL("/v1/messages", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${SENTINEL}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      messages,
      system,
      max_tokens: maxTokens ?? 1024,
      stream: false,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`openclaude router ${res.status}: ${text}`);
  }

  return res.json();
}
