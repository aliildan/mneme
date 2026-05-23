import { loadConfig, saveConfig, configPaths } from "../../config/mneme-config.js";
import { listModels, isOpus, invalidateModelCache } from "../../openclaude/models.js";
import { DISCOVERY_ACTIVE_FILE } from "../../config/paths.js";
import { readFile, writeFile } from "node:fs/promises";

async function readActiveModel() {
  try { return (await readFile(DISCOVERY_ACTIVE_FILE, "utf8")).trim() || null; }
  catch { return null; }
}

function printMenu(entries, configured) {
  console.log("");
  console.log("  0. (none) — deterministic ranking only");
  for (let i = 0; i < entries.length; i++) {
    const m = entries[i];
    const costNote = m.warning ? `  ⚠ ${m.warning}` : "";
    const active = m.id === configured ? " ← current" : "";
    console.log(`  ${i + 1}. ${m.label ?? m.id} (${m.provider})${costNote}${active}`);
  }
  console.log("");
}

export async function modelDiscovery(args) {
  const entries = await listModels({ refresh: true });
  const config = await loadConfig();
  const configured = config.discoveryModel ?? null;

  if (args.length === 0) {
    console.log(`Configured discovery model: ${configured ?? "(none)"}`);
    const active = await readActiveModel();
    console.log(`Active in session:         ${active ?? "(none)"}`);
    printMenu(entries, configured);
    console.log("Run 'mneme model <number>' to select.");
    return;
  }

  const input = args[0];
  let index;

  if (input === "0" || input === "none" || input === "default") {
    // Unset discovery model
    const { discoveryModel: _, ...rest } = config;
    await saveConfig(rest);
    await writeFile(DISCOVERY_ACTIVE_FILE, "").catch(() => {});
    invalidateModelCache();
    console.log("Discovery model unset — using deterministic ranking.");
    return;
  } else if (/^\d+$/.test(input)) {
    index = Number(input) - 1;
  } else {
    index = entries.findIndex((e) => e.id === input || e.label === input);
  }

  if (index < 0 || index >= entries.length) {
    console.error(`Invalid selection: ${input}`);
    printMenu(entries, configured);
    process.exit(1);
  }

  const chosen = entries[index];

  if (isOpus(chosen.id)) {
    console.error("Opus models are excluded from the discovery model role.");
    process.exit(1);
  }

  config.discoveryModel = chosen.id;
  await saveConfig(config);
  await writeFile(DISCOVERY_ACTIVE_FILE, chosen.id).catch(() => {});
  invalidateModelCache();
  console.log(`Discovery model set to: ${chosen.id}`);
  console.log(`Config updated: ${configPaths.file}`);
}
