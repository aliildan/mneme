import { detectRoot } from "../../project/detect-root.js";
import { projectHash } from "../../project/project-hash.js";
import { projectDbPath, ensureProjectDir, ensureMnemeHome } from "../../config/paths.js";
import { writeProjectRecord } from "../../project/project-record.js";
import { openProjectDb } from "../../db/open.js";
import { migrateProjectDb } from "../../db/migrate.js";
import { ensureFresh } from "../../index/validator.js";
import { getDbCounts } from "../../index/index-writer.js";
import { loadConfig, ensureConfig } from "../../config/mneme-config.js";
import { ensureLogDir } from "../../util/logger.js";
import { join } from "node:path";
import { homedir } from "node:os";

export async function init(args) {
  await ensureLogDir();
  await ensureConfig();
  await ensureMnemeHome();

  const skipHook = args.includes("--no-hook");
  const positional = args.filter((a) => !a.startsWith("--"));
  const startDir = positional[0] ? join(process.cwd(), positional[0]) : undefined;
  const root = await detectRoot(startDir);
  const hash = projectHash(root);
  const dbPath = projectDbPath(hash);

  console.log(`Initializing Mneme for: ${root}`);
  console.log(`Project hash: ${hash}`);
  console.log(`Database: ${dbPath}`);

  await ensureProjectDir(hash);
  const db = await openProjectDb(hash, dbPath);
  migrateProjectDb(db);

  await writeProjectRecord(hash, {
    root,
    hash,
    createdAt: Date.now(),
    schemaVersion: 1,
  });

  const config = await loadConfig();

  console.log("Building initial index…");
  const result = await ensureFresh(db, root, { config });
  const counts = getDbCounts(db);

  console.log(`\nIndex complete:`);
  console.log(`  Files:   ${counts.files}`);
  console.log(`  Symbols: ${counts.symbols}`);
  console.log(`  Edges:   ${counts.edges}`);

  // Print MCP install snippet
  console.log(`\nAdd to your MCP config (~/.claude.json or project .mcp.json):`);
  console.log(`\n{`);
  console.log(`  "mcpServers": {`);
  console.log(`    "mneme": {`);
  console.log(`      "command": "mneme",`);
  console.log(`      "args": ["mcp"],`);
  console.log(`      "env": { "MNEME_PROJECT_ROOT": "${root}" }`);
  console.log(`    }`);
  console.log(`  }`);
  console.log(`}`);

  // Install slash command
  try {
    const { installSlashCommand } = await import("./install-slash-command.js");
    await installSlashCommand(root);
    console.log(`\n/mneme slash command installed to .claude/commands/mneme.md`);
  } catch {}

  // Install user-global PostToolUse hook (default-on, opt-out via --no-hook)
  if (skipHook) {
    console.log(`\nSkipped global hook install (--no-hook).`);
  } else {
    try {
      const { installGlobalHook } = await import("../install-hook.js");
      const r = await installGlobalHook();
      if (r.installed) {
        console.log(`\nInstalled PostToolUse hook to ${r.settingsPath}`);
        console.log(`Read/Edit/Write/Glob/Grep tool calls will now nudge mneme to re-index.`);
        console.log(`Run \`mneme uninstall-hook\` to remove it later.`);
      } else {
        console.log(`\nGlobal hook already present (${r.reason}); no changes to ${r.settingsPath}.`);
      }
    } catch (err) {
      console.warn(`\nWarning: could not install global hook: ${err.message}`);
      console.warn(`You can still use mneme by leading with mneme_get_context.`);
    }
  }
}
