# Mneme Agent-Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude Code actually use mneme by injecting project memory at session start (A) and steering the agent to prefer mneme's retrieval/recall/record tools (C).

**Architecture:** A new read-only `mneme session-context` CLI command emits a budgeted digest of project memory; a `SessionStart` hook installed by `mneme init` injects it into every session. A shipped Claude Code skill plus sharpened MCP tool descriptions steer the agent to call `mneme_get_context` / `recall` / `record`. No changes to indexing, ranking, or the discovery path. Slices B (auto-capture) and D (metrics) are out of scope.

**Tech Stack:** Node.js ESM, `better-sqlite3`, `@modelcontextprotocol/sdk`, Node built-in `node:test`.

## Global Constraints

- Node.js ≥ 20; ESM (`"type": "module"`); no new runtime dependencies.
- Tests use Node built-in `node:test`; every test file is listed explicitly in `package.json` `"test"` (no globs).
- `mneme session-context` must NEVER block or fail session start: any error → no output, exit 0.
- Follow existing patterns: `__mneme`-marked hook entries in `~/.claude/settings.json`, atomic settings writes, idempotent install/uninstall.
- Memory bodies are verbatim — never paraphrase when displaying; only truncate with an ellipsis.

---

### Task 1: `buildSessionDigest` pure selection/format function

**Files:**
- Create: `src/cli/commands/session-context.js`
- Test: `test/session-context.test.js`
- Modify: `package.json` (add test file to `"test"` script)

**Interfaces:**
- Produces: `buildSessionDigest(memories: Array<{kind:string, body:string, created_at:number}>, sc?: {kinds?:string[], tokenBudget?:number, maxItems?:number, perItemCharCap?:number}) => string` — returns markdown digest, or `""` when nothing qualifies.

- [ ] **Step 1: Write the failing test**

```js
// test/session-context.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSessionDigest } from "../src/cli/commands/session-context.js";

const mem = (kind, body, created_at = Date.now()) => ({ kind, body, created_at });

describe("buildSessionDigest", () => {
  test("returns empty string when there are no memories", () => {
    assert.equal(buildSessionDigest([], {}), "");
  });

  test("includes only configured kinds and groups them with headers", () => {
    const out = buildSessionDigest([
      mem("todo", "wire up SessionStart hook"),
      mem("decision", "use scoped npm name"),
      mem("learning", "tree-sitter wasm is slower"),
    ], { kinds: ["todo", "decision", "gotcha"] });
    assert.match(out, /## Project memory \(mneme\)/);
    assert.match(out, /\*\*Open todos\*\*/);
    assert.match(out, /wire up SessionStart hook/);
    assert.match(out, /use scoped npm name/);
    assert.doesNotMatch(out, /tree-sitter wasm is slower/, "learning excluded by default kinds");
  });

  test("orders todo before decision before gotcha", () => {
    const out = buildSessionDigest([
      mem("gotcha", "AAA"),
      mem("decision", "BBB"),
      mem("todo", "CCC"),
    ], { kinds: ["todo", "decision", "gotcha"] });
    assert.ok(out.indexOf("Open todos") < out.indexOf("Decisions"));
    assert.ok(out.indexOf("Decisions") < out.indexOf("Gotchas"));
  });

  test("respects maxItems", () => {
    const many = Array.from({ length: 30 }, (_, i) => mem("todo", `todo ${i}`, i));
    const out = buildSessionDigest(many, { kinds: ["todo"], maxItems: 5 });
    assert.equal((out.match(/- todo /g) || []).length, 5);
  });

  test("respects tokenBudget but always keeps at least one item", () => {
    const big = "x".repeat(4000); // ~1000 tokens at chars/4
    const out = buildSessionDigest([mem("todo", big), mem("todo", big)], { kinds: ["todo"], tokenBudget: 800 });
    assert.equal((out.match(/^- /gm) || []).length, 1, "only the first fits under budget");
  });

  test("truncates long bodies to perItemCharCap with an ellipsis", () => {
    const out = buildSessionDigest([mem("todo", "y".repeat(500))], { kinds: ["todo"], perItemCharCap: 50 });
    assert.match(out, /y{49}…/);
  });

  test("skips items with empty/non-string bodies", () => {
    const out = buildSessionDigest([mem("todo", ""), mem("todo", "real")], { kinds: ["todo"] });
    assert.equal((out.match(/^- /gm) || []).length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/session-context.test.js`
Expected: FAIL — `buildSessionDigest` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/cli/commands/session-context.js
const KIND_ORDER = { todo: 0, decision: 1, gotcha: 2, learning: 3 };
const KIND_LABELS = { todo: "Open todos", decision: "Decisions", gotcha: "Gotchas", learning: "Learnings" };

export function buildSessionDigest(memories, sc = {}) {
  const kinds = sc.kinds ?? ["todo", "decision", "gotcha"];
  const budget = sc.tokenBudget ?? 800;
  const maxItems = sc.maxItems ?? 15;
  const perItemCharCap = sc.perItemCharCap ?? 280;

  const filtered = (memories ?? [])
    .filter((m) => m && typeof m.body === "string" && m.body.trim() && kinds.includes(m.kind))
    .sort((a, b) =>
      (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99) ||
      (b.created_at ?? 0) - (a.created_at ?? 0));

  const picked = [];
  let usedTokens = 0;
  for (const m of filtered) {
    if (picked.length >= maxItems) break;
    const body = truncate(m.body.replace(/\s+/g, " ").trim(), perItemCharCap);
    if (!body) continue;
    const tokens = Math.ceil(body.length / 4);
    if (picked.length > 0 && usedTokens + tokens > budget) continue;
    picked.push({ kind: m.kind, body });
    usedTokens += tokens;
  }
  if (picked.length === 0) return "";

  let out = "## Project memory (mneme)\n\n";
  for (const kind of ["todo", "decision", "gotcha", "learning"]) {
    const arr = picked.filter((p) => p.kind === kind);
    if (arr.length === 0) continue;
    out += `**${KIND_LABELS[kind]}**\n`;
    for (const p of arr) out += `- ${p.body}\n`;
    out += "\n";
  }
  return out;
}

function truncate(s, cap) {
  return s.length > cap ? s.slice(0, cap - 1) + "…" : s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/session-context.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the test file to the npm test script**

In `package.json`, append `test/session-context.test.js` to the space-separated file list in the `"test"` script.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/session-context.js test/session-context.test.js package.json
git commit -m "feat(session-context): buildSessionDigest selects + formats project memory"
```

---

### Task 2: `mneme session-context` command + config defaults + CLI registration

**Files:**
- Modify: `src/cli/commands/session-context.js` (add `sessionContext()`)
- Modify: `src/config/mneme-config.js:7-22` (add `sessionContext` to `DEFAULT_CONFIG`)
- Modify: `src/cli/index.js:1-7,49-60` (register command + help)
- Test: `test/session-context.test.js` (append integration tests)

**Interfaces:**
- Consumes: `buildSessionDigest` (Task 1); `detectRoot(startDir)`, `projectHash(root)`, `projectDbPath(hash)`, `loadConfig()`, `interpolateEnv()`, `listMemories(projectDb, globalDbPath, {scope, kind, limit})`.
- Produces: `sessionContext(): Promise<void>` — writes the digest to stdout (or nothing).

- [ ] **Step 1: Add `sessionContext` defaults to config**

In `src/config/mneme-config.js`, add this key to `DEFAULT_CONFIG` (after the `memory` block, before the closing brace):

```js
  sessionContext: {
    enabled: true,
    tokenBudget: 800,
    maxItems: 15,
    kinds: ["todo", "decision", "gotcha"],
    includeGlobal: false,
    perItemCharCap: 280,
  },
```

- [ ] **Step 2: Write the failing integration tests**

Append to `test/session-context.test.js`:

```js
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("sessionContext command", () => {
  async function withProject(run) {
    const home = await mkdtemp(join(tmpdir(), "mneme-sc-home-"));
    const proj = await mkdtemp(join(tmpdir(), "mneme-sc-proj-"));
    const prevHome = process.env.OPENCLAUDE_HOME;
    const prevRoot = process.env.MNEME_PROJECT_ROOT;
    process.env.OPENCLAUDE_HOME = home;
    process.env.MNEME_PROJECT_ROOT = await realpath(proj);
    let out = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out += s; return true; };
    try {
      await run({ home, root: process.env.MNEME_PROJECT_ROOT, getOut: () => out });
    } finally {
      process.stdout.write = origWrite;
      if (prevHome === undefined) delete process.env.OPENCLAUDE_HOME; else process.env.OPENCLAUDE_HOME = prevHome;
      if (prevRoot === undefined) delete process.env.MNEME_PROJECT_ROOT; else process.env.MNEME_PROJECT_ROOT = prevRoot;
      await rm(home, { recursive: true, force: true });
      await rm(proj, { recursive: true, force: true });
    }
  }

  test("emits a digest when the project is indexed and has memory", async () => {
    await withProject(async ({ root, getOut }) => {
      const { projectHash } = await import("../src/project/project-hash.js");
      const { projectDbPath } = await import("../src/config/paths.js");
      const { openProjectDb } = await import("../src/db/open.js");
      const { migrateProjectDb } = await import("../src/db/migrate.js");
      const { recordMemory } = await import("../src/memory/record.js");
      const { sessionContext } = await import("../src/cli/commands/session-context.js");

      const hash = projectHash(root);
      const dbPath = projectDbPath(hash);
      const db = await openProjectDb(hash, dbPath);
      migrateProjectDb(db);
      const gdb = join(process.env.OPENCLAUDE_HOME, "mneme", "global.db");
      await recordMemory(db, gdb, { kind: "todo", body: "ship session-context hook" });
      await recordMemory(db, gdb, { kind: "decision", body: "inject memory at SessionStart" });
      await recordMemory(db, gdb, { kind: "learning", body: "learning-should-not-appear" });

      await sessionContext();
      const out = getOut();
      assert.match(out, /Project memory \(mneme\)/);
      assert.match(out, /ship session-context hook/);
      assert.match(out, /inject memory at SessionStart/);
      assert.doesNotMatch(out, /learning-should-not-appear/);
    });
  });

  test("emits nothing when the project is not indexed", async () => {
    await withProject(async ({ getOut }) => {
      const { sessionContext } = await import("../src/cli/commands/session-context.js");
      await sessionContext();
      assert.equal(getOut(), "");
    });
  });
});
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `node --test test/session-context.test.js`
Expected: FAIL — `sessionContext` is not exported.

- [ ] **Step 4: Implement `sessionContext()`**

Add to the top and bottom of `src/cli/commands/session-context.js`:

```js
import Database from "better-sqlite3";
import { stat } from "node:fs/promises";
import { detectRoot } from "../../project/detect-root.js";
import { projectHash } from "../../project/project-hash.js";
import { projectDbPath } from "../../config/paths.js";
import { loadConfig, interpolateEnv } from "../../config/mneme-config.js";
import { listMemories } from "../../memory/recall.js";

export async function sessionContext() {
  try {
    const config = await loadConfig();
    const sc = config.sessionContext ?? {};
    if (sc.enabled === false) return;

    const startDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    let root;
    try { root = await detectRoot(startDir); } catch { return; }
    let hash;
    try { hash = projectHash(root); } catch { return; }

    const dbPath = projectDbPath(hash);
    try { await stat(dbPath); } catch { return; } // not indexed → silent no-op

    const includeGlobal = sc.includeGlobal === true;
    const globalDbPath = interpolateEnv(config.memory?.globalDbPath ?? "");
    const maxItems = sc.maxItems ?? 15;

    let rows = [];
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      rows = await listMemories(db, globalDbPath, {
        scope: includeGlobal ? "any" : "project",
        kind: "any",
        limit: maxItems * 4,
      });
    } finally {
      db.close();
    }

    const digest = buildSessionDigest(rows, sc);
    if (digest) process.stdout.write(digest);
  } catch {
    // Never break session start.
  }
}
```

(Keep `buildSessionDigest` and `truncate` from Task 1 in the same file.)

- [ ] **Step 5: Register the command in the CLI**

In `src/cli/index.js`: add `import { sessionContext } from "./commands/session-context.js";`, add `"session-context": sessionContext,` to the `COMMANDS` object, and add a HELP line under `mneme touch`:

```
  mneme session-context          Print project-memory digest (used by the SessionStart hook)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/session-context.test.js`
Expected: PASS (all digest + command tests).

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/session-context.js src/config/mneme-config.js src/cli/index.js test/session-context.test.js
git commit -m "feat(session-context): mneme session-context command + sessionContext config"
```

---

### Task 3: SessionStart hook install/uninstall + init wiring

**Files:**
- Modify: `src/cli/install-hook.js` (add SessionStart install/uninstall)
- Modify: `src/cli/commands/init.js:74-92` (install SessionStart hook)
- Modify: `src/cli/index.js:42-47` (uninstall both hooks)
- Test: `test/session-start-hook.test.js`
- Modify: `package.json` (add test file)

**Interfaces:**
- Produces: `installSessionStartHook(): Promise<{installed:boolean, reason?:string, settingsPath:string}>`, `uninstallSessionStartHook(): Promise<{removed:boolean, reason?:string, settingsPath:string}>`.

- [ ] **Step 1: Write the failing test**

```js
// test/session-start-hook.test.js
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let baseDir, originalHome, settingsPath;

before(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "mneme-sshook-"));
  originalHome = process.env.HOME;
  process.env.HOME = baseDir;
  settingsPath = join(baseDir, ".claude", "settings.json");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  await rm(baseDir, { recursive: true, force: true });
});

describe("installSessionStartHook / uninstallSessionStartHook", () => {
  test("install creates a SessionStart entry running session-context", async () => {
    const { installSessionStartHook } = await import("../src/cli/install-hook.js");
    const r = await installSessionStartHook();
    assert.equal(r.installed, true);
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const hooks = settings.hooks.SessionStart;
    assert.ok(Array.isArray(hooks) && hooks.length === 1);
    assert.equal(hooks[0].__mneme, "mneme-session-context");
    assert.match(hooks[0].hooks[0].command, /mneme session-context/);
  });

  test("install is idempotent", async () => {
    const { installSessionStartHook } = await import("../src/cli/install-hook.js");
    const r = await installSessionStartHook();
    assert.equal(r.installed, false);
    assert.equal(r.reason, "already-installed");
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(settings.hooks.SessionStart.length, 1);
  });

  test("uninstall removes only the mneme SessionStart entry", async () => {
    // pre-seed a user SessionStart hook
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: "echo user" }] });
    await mkdir(join(baseDir, ".claude"), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const { uninstallSessionStartHook } = await import("../src/cli/install-hook.js");
    const r = await uninstallSessionStartHook();
    assert.equal(r.removed, true);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(after.hooks.SessionStart.length, 1);
    assert.ok(!after.hooks.SessionStart.find((h) => h?.__mneme));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/session-start-hook.test.js`
Expected: FAIL — `installSessionStartHook` not exported.

- [ ] **Step 3: Implement the hook functions**

Append to `src/cli/install-hook.js`:

```js
const SESSION_HOOK_ID = "mneme-session-context";
const SESSION_COMMAND = "mneme session-context 2>/dev/null || true";

export async function installSessionStartHook() {
  const path = settingsPath();
  let settings = await readSettings(path);
  if (settings === null) {
    await mkdir(join(homedir(), ".claude"), { recursive: true });
    settings = {};
  }
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];

  const existing = settings.hooks.SessionStart.find((h) => h?.__mneme === SESSION_HOOK_ID);
  if (existing) return { installed: false, reason: "already-installed", settingsPath: path };

  settings.hooks.SessionStart.push({
    __mneme: SESSION_HOOK_ID,
    hooks: [{ type: "command", command: SESSION_COMMAND }],
  });
  await writeSettingsAtomic(path, settings);
  return { installed: true, settingsPath: path };
}

export async function uninstallSessionStartHook() {
  const path = settingsPath();
  const settings = await readSettings(path);
  if (settings === null) return { removed: false, reason: "no-settings", settingsPath: path };

  const hooks = settings.hooks?.SessionStart;
  if (!Array.isArray(hooks) || hooks.length === 0) {
    return { removed: false, reason: "no-hooks", settingsPath: path };
  }
  const filtered = hooks.filter((h) => h?.__mneme !== SESSION_HOOK_ID);
  if (filtered.length === hooks.length) return { removed: false, reason: "not-installed", settingsPath: path };

  settings.hooks.SessionStart = filtered;
  await writeSettingsAtomic(path, settings);
  return { removed: true, settingsPath: path };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/session-start-hook.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into `init`**

In `src/cli/commands/init.js`, inside the `else` branch of the `if (skipHook)` block (right after the PostToolUse install `try/catch`), add:

```js
    try {
      const { installSessionStartHook } = await import("../install-hook.js");
      const s = await installSessionStartHook();
      if (s.installed) {
        console.log(`Installed SessionStart hook — project memory will be injected at session start.`);
      } else {
        console.log(`SessionStart hook already present (${s.reason}).`);
      }
    } catch (err) {
      console.warn(`Warning: could not install SessionStart hook: ${err.message}`);
    }
```

- [ ] **Step 6: Make `uninstall-hook` remove both entries**

In `src/cli/index.js`, replace the `uninstallHook` function body with:

```js
async function uninstallHook() {
  const { uninstallGlobalHook, uninstallSessionStartHook } = await import("./install-hook.js");
  const a = await uninstallGlobalHook();
  const b = await uninstallSessionStartHook();
  console.log(a.removed ? `Removed PostToolUse hook from ${a.settingsPath}` : `PostToolUse: nothing to remove (${a.reason})`);
  console.log(b.removed ? `Removed SessionStart hook from ${b.settingsPath}` : `SessionStart: nothing to remove (${b.reason})`);
}
```

- [ ] **Step 7: Add the test file to the npm test script and run the full suite**

Append `test/session-start-hook.test.js` to `package.json` `"test"`. Then run:
`npm test`
Expected: PASS (all existing + new tests).

- [ ] **Step 8: Commit**

```bash
git add src/cli/install-hook.js src/cli/commands/init.js src/cli/index.js test/session-start-hook.test.js package.json
git commit -m "feat(session-context): install/uninstall SessionStart hook via mneme init"
```

---

### Task 4: Ship and install the `mneme` retrieval-steering skill (C1)

**Files:**
- Create: `skills/mneme/SKILL.md`
- Create: `src/cli/commands/install-skill.js`
- Modify: `src/cli/commands/init.js:67-72` (install skill near slash command)
- Modify: `package.json` `files` (add `"skills"`)
- Test: `test/install-skill.test.js`
- Modify: `package.json` (add test file)

**Interfaces:**
- Produces: `installSkill(projectRoot: string): Promise<void>` — copies `skills/mneme/SKILL.md` to `<projectRoot>/.claude/skills/mneme/SKILL.md`.

- [ ] **Step 1: Create the skill content**

```markdown
<!-- skills/mneme/SKILL.md -->
---
name: mneme
description: Use when finding or understanding code in this repo, recalling past decisions/gotchas/conventions, or after making a notable decision — route the work through mneme's index and memory instead of blind grep.
---

# Using mneme in this project

This project is indexed by **mneme** (MCP tools, kept auto-fresh). Prefer it over blind exploration:

- **Locating code** — before `grep`/`glob` to find where functionality lives or how something works, call `mneme_get_context` with the task in your own words. It returns ranked symbols + minimal snippets within a token budget.
- **Reusing past work** — before re-deriving a decision, convention, or fix, call `mneme_recall_memory` (search by text / kind / files).
- **Persisting decisions** — when you make a notable decision, hit a gotcha, or learn something durable about this repo, call `mneme_record_memory` (kind: `decision` | `gotcha` | `learning` | `todo`, body verbatim) so it's available in future sessions.

Plain `grep`/`read` are still fine for quick, known-path lookups. Reach for mneme when the question is "where/how does X work here?" or "did we already decide/learn this?".
```

- [ ] **Step 2: Write the failing test**

```js
// test/install-skill.test.js
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let projRoot;
before(async () => { projRoot = await mkdtemp(join(tmpdir(), "mneme-skill-")); });
after(async () => { await rm(projRoot, { recursive: true, force: true }); });

describe("installSkill", () => {
  test("copies SKILL.md into .claude/skills/mneme with frontmatter", async () => {
    const { installSkill } = await import("../src/cli/commands/install-skill.js");
    await installSkill(projRoot);
    const content = await readFile(join(projRoot, ".claude", "skills", "mneme", "SKILL.md"), "utf8");
    assert.match(content, /^---/);
    assert.match(content, /name:\s*mneme/);
    assert.match(content, /mneme_get_context/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/install-skill.test.js`
Expected: FAIL — `install-skill.js` not found.

- [ ] **Step 4: Implement `installSkill`**

```js
// src/cli/commands/install-skill.js
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(__dir, "../../../skills/mneme/SKILL.md");

export async function installSkill(projectRoot) {
  const dest = join(projectRoot, ".claude", "skills", "mneme");
  await mkdir(dest, { recursive: true });
  const content = await readFile(SOURCE, "utf8");
  await writeFile(join(dest, "SKILL.md"), content);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/install-skill.test.js`
Expected: PASS.

- [ ] **Step 6: Wire into `init`**

In `src/cli/commands/init.js`, right after the slash-command install `try/catch`, add:

```js
  try {
    const { installSkill } = await import("./install-skill.js");
    await installSkill(root);
    console.log(`mneme skill installed to .claude/skills/mneme/SKILL.md`);
  } catch {}
```

- [ ] **Step 7: Ship the skills directory in the package**

In `package.json`, add `"skills"` to the `files` array: `["bin", "src", "vendor", "slash-commands", "skills", "README.md"]`. Append `test/install-skill.test.js` to the `"test"` script.

- [ ] **Step 8: Verify package contents + full suite**

Run: `npm pack --dry-run 2>&1 | grep -E "skills/mneme/SKILL.md"`
Expected: the SKILL.md appears in the tarball listing.
Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add skills/mneme/SKILL.md src/cli/commands/install-skill.js src/cli/commands/init.js package.json test/install-skill.test.js
git commit -m "feat(adoption): ship + install mneme retrieval-steering skill"
```

---

### Task 5: Sharpen MCP tool descriptions (C2)

**Files:**
- Modify: `src/mcp/server.js:31,34,69,87` (export `TOOLS`; sharpen 3 descriptions)
- Test: `test/tool-descriptions.test.js`
- Modify: `package.json` (add test file)

**Interfaces:**
- Produces: `export const TOOLS` from `src/mcp/server.js` (already-existing array, now exported).

- [ ] **Step 1: Write the failing test**

```js
// test/tool-descriptions.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../src/mcp/server.js";

const byName = (n) => TOOLS.find((t) => t.name === n);

describe("MCP tool descriptions steer the agent", () => {
  test("get_context positions itself over grep", () => {
    const d = byName("mneme_get_context").description.toLowerCase();
    assert.match(d, /grep/);
    assert.match(d, /where|how/);
  });
  test("record_memory says when to record", () => {
    assert.match(byName("mneme_record_memory").description.toLowerCase(), /decision|gotcha/);
    assert.match(byName("mneme_record_memory").description, /verbatim|exact/i);
  });
  test("recall_memory says recall before re-deriving", () => {
    assert.match(byName("mneme_recall_memory").description.toLowerCase(), /before|re-?deriv/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tool-descriptions.test.js`
Expected: FAIL — `TOOLS` is not exported (and/or phrases absent).

- [ ] **Step 3: Export TOOLS and sharpen descriptions**

In `src/mcp/server.js`:
- Change `const TOOLS = [` to `export const TOOLS = [`.
- Replace the three `description` strings:

`mneme_get_context`:
```js
    description: "Find where functionality lives and how it works in this repo. Prefer this over grep/glob for 'where is X' / 'how does Y work' questions: returns ranked symbols + minimal code snippets within a token budget, revalidating the (auto-fresh) index first.",
```

`mneme_record_memory`:
```js
    description: "Store a verbatim decision, learning, gotcha, or todo for future sessions. Call this when you make a notable decision, hit a gotcha, or learn something durable about this repo. Body must be exact text — never paraphrased.",
```

`mneme_recall_memory`:
```js
    description: "Search project and global memory before re-deriving a past decision, convention, or fix. Query by text, kind, scope, files, or tags.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tool-descriptions.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Add test to npm script and run the full suite**

Append `test/tool-descriptions.test.js` to `package.json` `"test"`. Then:
`npm test`
Expected: PASS (full suite, incl. existing `mcp-smoke.test.js`).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.js test/tool-descriptions.test.js package.json
git commit -m "feat(adoption): sharpen get_context/record/recall tool descriptions"
```

---

## Manual verification (after all tasks)

The unit tests cannot prove the agent *uses* mneme — verify by hand:

1. **SessionStart wire format (the flagged unknown).** In a real Claude Code session inside an indexed project that has recorded memory, confirm the digest from `mneme session-context` actually appears in context. If plain stdout is not injected by the installed Claude Code version, switch the `SESSION_COMMAND` output to the JSON form `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<digest>"}}` and re-verify. (Implement only if needed.)
2. **Retrieval steering.** Ask "where is X handled in this repo?" → confirm the agent calls `mneme_get_context` rather than only grepping. If the skill never activates, fall back to appending a 3-line directive to the project `CLAUDE.md` in `init` (per the spec's fallback).
3. **Round-trip.** Make a decision in-session → confirm the agent records it → confirm it appears in the next session's digest.

---

## Self-Review

**Spec coverage:**
- A1 `mneme session-context` → Task 2. A1 selection/budget/format → Task 1. A2 SessionStart hook install/uninstall + init wiring → Task 3. A3 config block → Task 2 Step 1. C1 skill → Task 4. C2 tool descriptions → Task 5. Honest limitation (memory must be recorded) → addressed by C1 skill encouraging `record_memory`. Manual verification + flagged unknowns (wire format, skill activation) → Manual verification section. Out-of-scope B/D → not implemented (correct).
- No spec requirement left without a task.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". All code blocks are complete and runnable.

**Type consistency:** `buildSessionDigest(memories, sc)` defined in Task 1, consumed in Task 2 with the same shape. `sessionContext()` registered in CLI (Task 2) and invoked by the hook command string `mneme session-context` (Task 3). `installSessionStartHook`/`uninstallSessionStartHook` defined in Task 3, consumed by init/uninstall in the same task. `installSkill` defined and consumed in Task 4. `TOOLS` exported in Task 5 and consumed by its test. `listMemories(projectDb, globalDbPath, {scope,kind,limit})` matches `src/memory/recall.js`. `recordMemory(projectDb, globalDbPath, {...})`, `openProjectDb(hash, dbPath)`, `migrateProjectDb(db)` match existing usage.
