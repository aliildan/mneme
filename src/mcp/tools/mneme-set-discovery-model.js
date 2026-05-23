import { loadConfig, saveConfig } from "../../config/mneme-config.js";
import { listModels, isOpus, invalidateModelCache } from "../../openclaude/models.js";
import { DISCOVERY_ACTIVE_FILE } from "../../config/paths.js";
import { writeFile } from "node:fs/promises";
import { configPaths } from "../../config/mneme-config.js";

export async function handleSetDiscoveryModel(args, { config }) {
  const { id } = args;

  if (id && isOpus(id)) {
    throw new Error("Opus models are excluded from the discovery model role per Mneme design principles.");
  }

  // Best-effort membership check: warn if the router is reachable and the id
  // isn't in the listed models. We don't reject — the router may be offline,
  // or a new model may not yet be in the cache.
  let warning = null;
  if (id) {
    try {
      const models = await listModels();
      if (models.length > 0 && !models.some((m) => m.id === id)) {
        warning = `Model "${id}" was not found in the current model list. The selection was still saved; use mneme_list_models to see available options.`;
      }
    } catch {}
  }

  const cfg = await loadConfig();
  cfg.discoveryModel = id ?? null;
  await saveConfig(cfg);

  // Write discovery-active file for session visibility
  await writeFile(DISCOVERY_ACTIVE_FILE, id ?? "").catch(() => {});
  invalidateModelCache();

  return { ok: true, set_to: id ?? null, config_path: configPaths.file, ...(warning ? { warning } : {}) };
}
