# Mneme agent-adoption design — SessionStart memory injection + retrieval steering

**Date:** 2026-06-23
**Status:** Approved for spec review
**Scope:** Slice A + C of the "make the agent actually use mneme" brainstorm. Slices B (auto-capture) and D (measurement loop) are explicitly **out of scope** here and noted under Future Work.

## Problem

mneme's index and memory work, but the agent (Claude Code) doesn't reliably *use* them. Two distinct failure modes:

1. **Retrieval isn't called.** `mneme_get_context` competes with the agent's own `grep`/`read`, which it already trusts, so the MCP tools sit idle.
2. **Memory isn't surfaced.** Even when project memory exists, nothing brings it into a new session, so the defensible half of mneme (verbatim cross-session decisions/gotchas/todos) delivers no value unless the agent happens to search for it.

This design addresses both with the lowest-risk levers: **deterministic injection of memory at session start (A)** and **behavioral steering of retrieval (C)**. It deliberately avoids always-on per-prompt injection and automatic memory writes, which carry token-noise and pollution risk.

## Goals / non-goals

**Goals**
- Every Claude Code session in an indexed project opens with a compact, high-signal slice of project memory injected as context — no tool call required.
- The agent reliably prefers `mneme_get_context` / `mneme_recall_memory` when they're the right tool, and is nudged to *record* decisions as it works (so memory exists for next session to surface).
- Both behaviors install via the existing `mneme init` flow and are removable.
- Never block or slow session start; degrade silently when there's no index/memory.

**Non-goals (this slice)**
- No `Stop`/`SubagentStop` auto-capture of memory (slice B).
- No per-prompt `UserPromptSubmit` retrieval injection.
- No metrics/evaluation harness (slice D) beyond what already exists.
- No changes to ranking, indexing, or the discovery-model path.

## Honest limitation (stated up front)

With auto-capture (B) deferred, **memory is only populated when the agent records it.** So A surfaces memory that C helps create. On a fresh project with no recorded memory, A shows nothing — that is correct (no noise), not a bug. C's steering therefore must also encourage recording, otherwise A has nothing to inject. This is the main reason A and C ship together rather than separately.

## Component A — SessionStart memory injection (deterministic)

### A1. New CLI command: `mneme session-context`
A fast, read-only command that prints a compact project-memory digest for injection.

- **Project resolution:** reuse existing root detection (`MNEME_PROJECT_ROOT` env, else walk up for `.mneme`/`.git`/`package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`). Same logic the MCP server uses.
- **Data source:** the project `index.db` memory table (+ optionally `global.db` if `includeGlobal`). **No `ensureFresh` / Merkle walk / parsing** — this reads memory only, so it stays fast (target < ~50 ms).
- **Selection:** exclude `forgotten_at` rows; prioritize by kind (`todo`, then `decision`, then `gotcha`; `learning` lowest), then by recency. Cap by `maxItems` and a token budget.
- **Output:** concise markdown grouped by kind under a header like `## Project memory (mneme)`. Truncate long bodies to a per-item cap. If there is no index, no memory, or any error → **print nothing and exit 0** (never break session start).

### A2. SessionStart hook registration
- `mneme init` installs a `SessionStart` hook entry in `~/.claude/settings.json` (user-global, alongside the existing PostToolUse freshness hook) that runs `mneme session-context`.
- The hook emits the digest via the SessionStart context-injection mechanism. **Open verification item:** confirm the exact current Claude Code wire format — JSON `hookSpecificOutput.additionalContext` vs. plain stdout — and use whichever the running version honors. The implementation plan must verify this against the installed Claude Code before relying on it.
- Install is **idempotent** (no duplicate entries), respects `--no-hook`, and `mneme uninstall-hook` removes the SessionStart entry in addition to the PostToolUse one.

### A3. Config
Extend `DEFAULT_CONFIG` in `src/config/mneme-config.js`:

```jsonc
"sessionContext": {
  "enabled": true,
  "tokenBudget": 800,
  "maxItems": 15,
  "kinds": ["todo", "decision", "gotcha"],
  "includeGlobal": false,
  "perItemCharCap": 280
}
```

Read via `loadConfig()` (already hot-reloaded per call). `enabled: false` makes `session-context` a no-op.

## Component C — Retrieval steering (behavioral)

### C1. A Claude Code skill
Ship a skill that teaches the workflow and is installed by `mneme init` (e.g. into the project's `.claude/skills/mneme/SKILL.md`). Content, kept short and behavioral:
- When the user asks where functionality lives / to find or understand code in this repo, call `mneme_get_context` **before** grepping; it returns ranked symbols + minimal snippets within a token budget and stays auto-fresh.
- Before re-deriving something likely decided before, call `mneme_recall_memory`.
- When you make a notable decision / hit a gotcha / learn something durable, call `mneme_record_memory` so it's available next session.

**Risk:** skill activation is model-driven (depends on the description matching intent). If verification shows it doesn't reliably activate, fall back to a short directive block appended to the project `CLAUDE.md` by `mneme init` (always in context, at the cost of a few tokens per task). The plan should test activation and choose.

### C2. Sharpen MCP tool descriptions
In `src/mcp/server.js`, tighten the descriptions of the high-value tools so the model reaches for them at the right moment — without removing any tools:
- `mneme_get_context`: position it as the first choice for "where is X / how does Y work" over grep/glob; mention the token budget and auto-freshness.
- `mneme_recall_memory` / `mneme_record_memory`: make the recall-before-rederive and record-decisions intent explicit.

## Data flow

```
Session opens
  └─ Claude Code runs SessionStart hook → `mneme session-context`
       └─ resolve project → read memory (index.db [+ global.db])
            └─ select + budget → markdown digest → injected as context
                 (no index/memory/error → empty, exit 0)

During the task
  └─ skill (C1) + tool descriptions (C2) steer the model to:
       get_context (locate) · recall_memory (reuse) · record_memory (persist)
            └─ recorded memory feeds the next session's A digest
```

## Error handling
- `session-context` is best-effort: any failure (missing DB, locked DB, parse error, no project) → no output, exit 0. It must never throw a non-zero exit into the SessionStart hook.
- Hook install/uninstall must be idempotent and must not corrupt an existing `~/.claude/settings.json` (parse, merge, write; back out on parse failure).
- Tool-description and skill changes are static; no runtime error surface.

## Testing
- **`session-context` unit tests:** populated memory → expected grouped/truncated/budgeted output; empty DB and missing DB → empty output + exit 0; `forgotten_at` excluded; `enabled:false` → no-op; budget/maxItems/perItemCharCap respected.
- **Install tests (extend `test/install-hook.test.js`):** `mneme init` adds the SessionStart entry idempotently; `uninstall-hook` removes both SessionStart and PostToolUse; `--no-hook` skips.
- **Skill/descriptions:** snapshot the skill file is installed with valid frontmatter; assert the sharpened descriptions are present on the key tools. Activation/usage is validated by a **manual smoke test** (see below), not unit tests.
- Full suite (`npm test`) stays green.

## Manual verification (the real proof)
1. Index a project, record 2–3 memories, start a fresh Claude Code session → confirm the memory digest appears in context.
2. Ask "where is X handled in this repo?" → confirm the agent calls `mneme_get_context` rather than only grepping.
3. Make a decision in-session → confirm the agent records it (C1), and that it appears in the next session's digest (A).

## Future work (deferred, not this slice)
- **B — `Stop`/`SubagentStop` auto-capture:** extract decisions/gotchas via a cheap Ollama call routed through openclaude, with conservative dedupe + audit. Removes the reliance on the agent recording memory.
- **D — measurement loop:** wire `mneme_record_outcome` (optionally from the Stop hook) and surface `mneme stats` to prove token/accuracy benefit.
