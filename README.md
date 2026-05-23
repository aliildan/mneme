<p align="center">
  <img src="./mneme_logo.png" alt="Mneme" width="220" />
</p>

<h1 align="center">Mneme</h1>

<p align="center">
  <strong>Local context &amp; memory engine for AI coding agents.</strong><br/>
  A precise symbol index of your codebase and a verbatim memory of past decisions — exposed over MCP, running entirely on your machine.
</p>

<p align="center">
  <a href="#install"><img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A520-43853d?style=flat-square&logo=node.js&logoColor=white" /></a>
  <img alt="MCP" src="https://img.shields.io/badge/MCP-stdio-5b21b6?style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
</p>

<p align="center">
  <a href="#setup">Setup</a> ·
  <a href="#mcp-tools">MCP tools</a> ·
  <a href="#memory-model">Memory model</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#design-principles">Principles</a>
</p>

---

## Why Mneme

AI coding agents waste tokens and degrade in quality because they load too much irrelevant context and forget what they've already learned. Mneme — named for the Greek personification of memory — fixes both, **locally**:

| | Without Mneme | With Mneme |
| --- | --- | --- |
| **Finding code** | grep + read whole files into the prompt | Ranked symbols + minimal snippets, within a token budget |
| **Re-using decisions** | The agent rediscovers what it learned last week | Verbatim recall of decisions, gotchas, learnings, todos |
| **Cost** | Cloud embedding API + full-file loads | One SQLite file. Zero network. Zero embeddings cost. |
| **Cross-project leakage** | Easy to mix learnings between repos | Isolated by project hash; globals require explicit promotion |

The goal is **measurably fewer tokens per task and more accurate context selection** — not raw text compression.

---

## Status

`v0.1` — feature-complete for Phases 1, 2, and 4 of the architecture plan. Phase 3 multi-language symbol extraction ships (TypeScript, JavaScript, Python, Go, Rust, PHP, C#); the `sqlite-vec` semantic-search half of Phase 3 is deferred.

- **182 tests**, 0 failures, ~9 seconds end-to-end
- **7 languages** indexed via tree-sitter WASM
- **15 MCP tools** exposed over stdio
- **Auto-indexing on file reads** — `mneme init` installs a user-global Claude Code hook that nudges the index on every Read/Edit/Write
- **Discovery model optional** — Mneme runs without one and never blocks on a model

---

## How it works

```
┌──────────────────┐        ┌──────────────────────┐        ┌────────────────┐
│  Claude Code /   │  MCP   │   mneme stdio        │  SQL   │ index.db       │
│  Cursor / any    │ ─────▶ │   (15 tools)         │ ─────▶ │ + global.db    │
│  MCP-capable     │  JSON  │                      │  WAL   │ (per-project)  │
│  agent           │ ◀───── │  ┌────────────────┐  │ ◀───── │                │
└──────────────────┘        │  │ ensureFresh    │  │        └────────────────┘
                            │  │   ├ Merkle walk│  │
                            │  │   ├ tree-sitter│  │
                            │  │   └ FTS5 upsert│  │
                            │  └────────────────┘  │
                            │  ┌────────────────┐  │        ┌────────────────┐
                            │  │ rank → discov. │  │  HTTP  │ openclaude     │
                            │  │ model → budget │  │ ─────▶ │ router         │
                            │  └────────────────┘  │        │ (optional)     │
                            └──────────────────────┘        └────────────────┘
```

Every MCP call routes through `ensureFresh`: a bottom-up Merkle walk over blake3 content hashes that prunes unchanged subtrees in microseconds and reparses only what actually changed. The result is a stale-free index without polling, watchers, or git hooks.

<img width="1657" height="618" alt="image" src="https://github.com/user-attachments/assets/b9963941-8187-490b-a404-f1c71572f69b" />

---

## Requirements

- **Node.js ≥ 20**
- A C++ toolchain **only if** `better-sqlite3` lacks a prebuilt binary for your platform (uncommon on macOS, Linux, Windows x64)
- *Optional:* [openclaude](https://github.com/aildan/openclaude) on `127.0.0.1:11436` for the discovery-model feature and the `/mneme` slash command

---

## Install

The recommended way works on every platform — clone, then `npm link` to register `mneme` / `mn` globally:

```bash
git clone https://github.com/aildan/mneme.git
cd mneme
npm install     # pulls better-sqlite3, tree-sitter wasms, MCP sdk
npm test        # sanity check — 182 tests should pass in ~9s
npm link        # registers `mneme` and `mn` on your PATH via npm's shim
```

`npm link` works because `package.json` declares both bin names. On Windows it produces `.cmd` shims; on Unix it symlinks into your global `bin` directory. Either way, `mneme` works from any cwd.

### Platform-specific notes

**Linux** — if you prefer a manual symlink over `npm link`:

```bash
git clone https://github.com/aildan/mneme.git ~/.openclaude/mneme-repo
mkdir -p ~/.local/bin
ln -s ~/.openclaude/mneme-repo/bin/mneme ~/.local/bin/mneme
ln -s ~/.openclaude/mneme-repo/bin/mneme ~/.local/bin/mn
# make sure ~/.local/bin is on $PATH
```

**macOS** — `npm link` is the path of least resistance. Manual install also works, but the symlink destination differs by setup:

```bash
git clone https://github.com/aildan/mneme.git ~/.openclaude/mneme-repo
# Apple Silicon (Homebrew):
ln -s ~/.openclaude/mneme-repo/bin/mneme /opt/homebrew/bin/mneme
ln -s ~/.openclaude/mneme-repo/bin/mneme /opt/homebrew/bin/mn
# Intel Macs:
ln -s ~/.openclaude/mneme-repo/bin/mneme /usr/local/bin/mneme
ln -s ~/.openclaude/mneme-repo/bin/mneme /usr/local/bin/mn
```

If you installed Node via `nvm`, `npm link` will land the shim in the active nvm-managed `bin` directory automatically.

**Windows** — use `npm link` from PowerShell or `cmd.exe`. Manual symlinks need admin privileges or Developer Mode, so they're not recommended. The config file path is `%USERPROFILE%\.openclaude\mneme.json` and per-project indexes live under `%USERPROFILE%\.openclaude\mneme\projects\`. Everything else is path-agnostic.

> Mneme stores its index and memory databases under `~/.openclaude/mneme/` (or `%USERPROFILE%\.openclaude\mneme\` on Windows), sharing the home directory with openclaude.

---

## Setup

From zero to "Claude Code can use it" in five steps.

### 1. Build &amp; install Mneme

```bash
cd /path/to/mneme
npm install          # pulls better-sqlite3, tree-sitter wasms, MCP sdk
npm test             # sanity check — should print "182 pass"
npm link             # puts `mneme` and `mn` on your PATH
```

Verify it's on your PATH:

```bash
which mneme          # /opt/homebrew/bin/mneme (or similar)
mneme help
```

> **Gotcha:** `npm link` requires your global npm prefix to be on PATH. If `which mneme` is empty, run `npm config get prefix` and add `<prefix>/bin` to your shell rc.

### 2. Index a project

Go into **any** repo you want Mneme to know about and run `init`:

```bash
cd /path/to/some/project
mneme init
```

This:
- detects the project root
- writes `~/.openclaude/mneme/projects/<hash>/index.db`
- parses every `.ts / .js / .py / .go / .rs / .php / .cs` file in the tree
- installs the `/mneme` slash command under `.claude/commands/`
- installs a user-global PostToolUse hook in `~/.claude/settings.json` so every Read/Edit/Write/Glob/Grep nudges Mneme to re-index (pass `--no-hook` to skip; run `mneme uninstall-hook` to remove later)
- **prints an MCP snippet to stdout** — copy it, you need it next

Sanity-check:

```bash
mneme status         # file / symbol / edge counts and merkle root
```

### How auto-indexing on reads works

The PostToolUse hook runs `mneme touch` after every Read/Edit/Write/Glob/Grep/MultiEdit tool call. That's a fast (~50–100 ms) side-effect-only command — no DB open, no parsing — that just drops a `.dirty` marker file next to the project index. On the **next** `mneme_*` MCP call, `ensureFresh` sees the marker, bypasses the usual 250 ms debounce, re-validates the Merkle tree, reparses anything changed, and deletes the marker. Net effect: the index never goes stale just because the agent was exploring with non-mneme tools.

### 3. Wire it into Claude Code

Open `~/.claude.json` and paste the snippet `init` printed into the `mcpServers` block:

```jsonc
{
  "mcpServers": {
    "mneme": {
      "command": "mneme",
      "args": ["mcp"],
      "env": { "MNEME_PROJECT_ROOT": "/abs/path/to/project" }
    }
  }
}
```

> **One Mneme entry per project.** If you work in N repos, you get N `mcpServers` entries — each with its own `MNEME_PROJECT_ROOT`.

Restart Claude Code. In a session, run `/mcp` — you should see `mneme` listed as connected with 15 tools.

### 4. *(Optional)* Pick a discovery model

Only if you also run [openclaude](https://github.com/aildan/openclaude) on `127.0.0.1:11436`:

```bash
mneme model          # interactive numbered menu
# or
mneme model 3        # by index
```

The selection is written to `~/.openclaude/mneme.json` and applied on the **next** request — no restart needed. Skip this entirely and Mneme uses its deterministic ranker; nothing breaks.

### 5. Smoke test

In Claude Code, ask the agent:

> *"Use `mneme_get_context` to find the auth middleware in this repo."*

If you see ranked symbols come back with file paths and line ranges, you're done.

> **Hot config:** Mneme re-reads `~/.openclaude/mneme.json` on **every** MCP request — no restart needed after config edits.

---

## MCP tools

Fifteen idempotent tools. All are read-only at the MCP surface; index writes happen as a deterministic refresh side-effect of `ensureFresh` before any read.

### Retrieval

| Tool | Purpose |
| --- | --- |
| `mneme_get_context` | Ranked symbols + snippets for a task within a token budget. |
| `mneme_lookup_symbol` | Direct symbol lookup by name (with optional `kind` filter). |
| `mneme_callers` / `mneme_callees` | Walk the dependency graph N hops. |

### Memory

| Tool | Purpose |
| --- | --- |
| `mneme_record_memory` | Append a verbatim decision / learning / gotcha / todo. |
| `mneme_recall_memory` | Search memory by text, kind, scope, files, tags. |
| `mneme_list_memories` | Paginate without scoring. |
| `mneme_forget` | Soft-delete by id (body preserved for audit). |
| `mneme_promote_memory` | Explicitly copy a project memory to global scope. |
| `mneme_gc_memory` | Manually soft-delete stale memories. |
| `mneme_search_projects` | Cross-project memory recall (opt-in; memory only, never code). |

### Operations

| Tool | Purpose |
| --- | --- |
| `mneme_index_status` | Index health: file counts, schema version, merkle root. |
| `mneme_list_models` | Available discovery models (Ollama + curated Anthropic, Opus excluded). |
| `mneme_set_discovery_model` | Choose the discovery model (`null` = deterministic). |
| `mneme_record_outcome` | Record whether a `get_context` call succeeded — closes the metrics loop. |

---

## Memory model

Two physical databases, one purpose each:

- `~/.openclaude/mneme/projects/<hash>/index.db` — symbols, edges, chunks, and **project-scope** memory
- `~/.openclaude/mneme/global.db` — **global-scope** memory only, shared across projects

Memory has four kinds (`decision`, `learning`, `gotcha`, `todo`) and two scopes (`project`, `global`). Recall searches both by default and slightly favors project results over global.

A memory becomes global **only through explicit action**:

- `mneme_record_memory({scope: "global"})` writes directly to `global.db`
- `mneme_promote_memory({id})` copies an existing project row to global with `source: "promoted"`

> **Mneme never auto-promotes.** Misjudging a project-specific fact as portable would leak it everywhere.

Soft delete only. `mneme_forget` sets `forgotten_at`; the body is preserved for audit and excluded from future recall.

---

## Supported languages

| Language | Extensions | Coverage |
| --- | --- | --- |
| **TypeScript / JavaScript** | `.ts .tsx .js .jsx .mjs .cjs` | Full symbols + edges. `.d.ts` skipped. |
| **Python** | `.py .pyw` | Functions, classes, decorated functions, imports. Methods inside classes carry `container` (parent class name). |
| **Go** | `.go` | Functions, methods, structs, interfaces, grouped imports. |
| **Rust** | `.rs` | Functions, structs (`class`), enums, traits (`interface`), impl blocks, `use` declarations. |
| **PHP** | `.php .phtml .phar` | Functions, methods, classes, interfaces, traits (`class`), enums, `use` imports. Method `exported` reflects `public`/`private`/`protected`. |
| **C#** | `.cs` | Classes, structs (`class`), records (`class`), interfaces, enums, methods, `using` directives. `exported` reflects `public` (with interface members treated as implicitly public). |

Other languages walk fine but extract no symbols (`language: "unknown"`).

---

## CLI

```text
mneme mcp                Start the MCP stdio server (what Claude Code spawns)
mneme init [path]        Initialize project index, install slash command + hook, print MCP snippet
mneme init --no-hook     Same as above, but skip installing the user-global PostToolUse hook
mneme reindex            Force a full re-parse
mneme status             Index health and config
mneme stats              Retrieval-outcome metrics (success rate, median tokens)
mneme model              Show / select discovery model interactively
mneme model <n>          Set discovery model by menu number (0 = none)
mneme gc [--days N]      Manually GC memories older than N days (default 90)
mneme touch              Mark project index dirty (called by the Claude Code hook)
mneme uninstall-hook     Remove Mneme's PostToolUse entry from ~/.claude/settings.json
mneme help               Show help
```

Both `mneme` and the short alias `mn` are installed.

---

## Configuration

`~/.openclaude/mneme.json` is read on **every** MCP request — edit it and changes take effect without restarting. On parse error Mneme falls back to defaults and logs a warning.

```json
{
  "discoveryModel": null,
  "router": { "baseUrl": "http://127.0.0.1:11436" },
  "indexer": {
    "maxFileBytes": 1048576,
    "ignore": [".git", "node_modules", "dist", "build", ".next", ".venv", "target", ".mneme"],
    "languages": ["typescript", "python", "go", "rust", "php", "csharp"]
  },
  "retrieval": {
    "defaultTokenBudget": 6000,
    "perFileCap": 800,
    "tokenizer": "chars/4"
  },
  "memory": {
    "globalDbPath": "$HOME/.openclaude/mneme/global.db"
  },
  "cross_project": {
    "enabled": false,
    "allow": []
  }
}
```

**Environment variables:**

| Variable | Effect |
| --- | --- |
| `MNEME_PROJECT_ROOT` | Pin the project root (otherwise auto-detected from `.mneme`, `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`). |
| `MNEME_QUIET=1` | Suppress non-error logs. |
| `MNEME_DEBUG=1` | Include stack traces on CLI errors. |

---

## Architecture

A walker traverses the project root in lexicographic order, filtering via `.gitignore`, `.mnemeignore`, and config ignores. Each file's blake3 content hash becomes a leaf in a Merkle tree of directory-node hashes. On every MCP request the validator does a bottom-up walk: directory hashes that match the cached value let the entire subtree be pruned (no per-file work). Dirty files are reparsed by language plugins, symbols and edges are upserted in a single transaction, and a second pass resolves edge targets across files.

SQLite (WAL mode, FTS5 for symbol search) is the only storage. The deterministic ranker scores candidates from FTS5 BM25, path-token matches, hint boosts, dependency 1-hop neighbors, recency, and the `exported` flag. The optional discovery model receives the top 60 candidates and returns a `{keep, drop}` JSON object — it can only remove, never reorder or add. The budget filler then packs symbols and code snippets until the token budget or per-file cap is hit, returning a **cache-stable** response.

---

## Design principles

These are enforced in code, not just documented:

1. **Correctness over freshness.** Lazy validation at query time — a stale index that returns wrong files is worse than a slow one.
2. **Verbatim, never summarized memory.** Paths, errors, identifiers are stored exactly.
3. **The discovery model narrows, it does not decide.** Wrong context selection actively harms the agent.
4. **Do not break prompt caching.** Stable response prefix; volatile metadata at the end of the response.
5. **Measure everything.** `retrieval_outcomes` table + `mneme stats` close the feedback loop.
6. **Stay small and composable.** No build step. ESM. Node built-in `test`. Mirror openclaude conventions where they apply.
7. **Isolate projects; share globals only by explicit choice.** Default project-local. Never auto-promote.

---

## Roadmap

What's deferred for a later release:

- **`sqlite-vec` semantic search** and the embedding pipeline (Phase 3 scaffolding exists in `rank-v3.js` and the `chunks` table, but no embedder is wired up). BM25 over symbols is the active retrieval path today.
- **`mneme outcome <id>` CLI** — a wrapper for `mneme_record_outcome`. Agents call the tool directly for now.
- **Container tracking** for PHP and C# methods (only Python tracks parent class today).
- **Large-repo benchmarks** (5k+ files). The plan targets `<200ms` full walk and `<50ms p50` for `mneme_get_context`; these still need real-world verification.

---

## Testing

```bash
npm test
```

Runs **182 tests across 36 suites in ~9 seconds**. The test list is explicit in `package.json` — no glob, no hidden tests. Golden snapshots for symbol extraction live under `test/golden/`.

---

## License

MIT — see [LICENSE](LICENSE).

<p align="center">
  <sub>Built as a companion to <a href="https://github.com/aildan/openclaude">openclaude</a>. Local-first. No telemetry.</sub>
</p>
