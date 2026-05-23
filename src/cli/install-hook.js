import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const HOOK_ID = "mneme-touch-on-read";
const MATCHER = "Read|Edit|Write|Glob|Grep|MultiEdit";
const COMMAND = "mneme touch 2>/dev/null || true";

function settingsPath() {
  return join(homedir(), ".claude", "settings.json");
}

async function readSettings(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeSettingsAtomic(path, settings) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + "\n");
  await rename(tmp, path);
}

export async function installGlobalHook() {
  const path = settingsPath();
  let settings = await readSettings(path);
  if (settings === null) {
    await mkdir(join(homedir(), ".claude"), { recursive: true });
    settings = {};
  }

  settings.hooks ??= {};
  settings.hooks.PostToolUse ??= [];

  const existing = settings.hooks.PostToolUse.find((h) => h?.__mneme === HOOK_ID);
  if (existing) return { installed: false, reason: "already-installed", settingsPath: path };

  settings.hooks.PostToolUse.push({
    __mneme: HOOK_ID,
    matcher: MATCHER,
    hooks: [{ type: "command", command: COMMAND }],
  });

  await writeSettingsAtomic(path, settings);
  return { installed: true, settingsPath: path };
}

export async function uninstallGlobalHook() {
  const path = settingsPath();
  const settings = await readSettings(path);
  if (settings === null) return { removed: false, reason: "no-settings", settingsPath: path };

  const hooks = settings.hooks?.PostToolUse;
  if (!Array.isArray(hooks) || hooks.length === 0) {
    return { removed: false, reason: "no-hooks", settingsPath: path };
  }

  const filtered = hooks.filter((h) => h?.__mneme !== HOOK_ID);
  if (filtered.length === hooks.length) {
    return { removed: false, reason: "not-installed", settingsPath: path };
  }

  settings.hooks.PostToolUse = filtered;
  await writeSettingsAtomic(path, settings);
  return { removed: true, settingsPath: path };
}
