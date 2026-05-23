import { init } from "./commands/init.js";
import { reindex } from "./commands/reindex.js";
import { status } from "./commands/status.js";
import { stats } from "./commands/stats.js";
import { modelDiscovery } from "./commands/model-discovery.js";
import { gc } from "./commands/gc.js";
import { touch } from "./commands/touch.js";

const HELP = `mneme — local context and memory engine for AI coding agents

Usage:
  mneme mcp                      Start MCP stdio server (for Claude Code / Cursor / Continue)
  mneme init [path]              Initialize project index and print MCP install snippet
  mneme init --no-hook           Initialize without installing the user-global Read hook
  mneme reindex                  Force full re-parse of the current project
  mneme status                   Show project index health and configuration
  mneme stats                    Show retrieval outcome metrics
  mneme model                    Show / select discovery model
  mneme model <n>                Set discovery model by number
  mneme gc [--days <n>]          Soft-delete stale memories (manual)
  mneme touch                    Mark project index dirty (used by Claude Code hooks)
  mneme uninstall-hook           Remove mneme's PostToolUse entry from ~/.claude/settings.json
  mneme help                     Show this help

Storage:
  Index:  ~/.openclaude/mneme/projects/<hash>/index.db
  Global: ~/.openclaude/mneme/global.db
  Config: ~/.openclaude/mneme.json

Config (hot-reloaded per request):
  discoveryModel   Provider:modelId for candidate narrowing (null = deterministic only)
  router.baseUrl   openclaude router URL (default: http://127.0.0.1:11436)
  indexer.*        Walk + parse settings
  retrieval.*      Budget and weight settings
`;

async function mcp(args) {
  const { startMcpServer } = await import("../mcp/server.js");
  await startMcpServer();
}

async function uninstallHook() {
  const { uninstallGlobalHook } = await import("./install-hook.js");
  const r = await uninstallGlobalHook();
  if (r.removed) console.log(`Removed mneme PostToolUse hook from ${r.settingsPath}`);
  else console.log(`Nothing to remove (${r.reason})`);
}

const COMMANDS = {
  mcp,
  init,
  reindex,
  status,
  stats,
  model: modelDiscovery,
  gc,
  touch,
  "uninstall-hook": uninstallHook,
  help: () => console.log(HELP),
};

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
  console.log(HELP);
  process.exit(0);
}

const handler = COMMANDS[cmd];
if (!handler) {
  console.error(`unknown command: ${cmd}\n`);
  console.error(HELP);
  process.exit(2);
}

try {
  await handler(rest);
} catch (err) {
  console.error(`error: ${err.message}`);
  if (process.env.MNEME_DEBUG) console.error(err.stack);
  process.exit(1);
}
