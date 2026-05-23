// chars/4 is 70-95% accurate for code — fast, deterministic, no network call.
export function estimateTokens(text) {
  return Math.ceil((text?.length ?? 0) / 4);
}
