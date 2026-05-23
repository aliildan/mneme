// Language plugin registry — maps file extensions to parser plugins.
// Each plugin implements: { id, extensions, extractSymbolsAndEdges(relPath, bytes) }

const registry = new Map();

export function registerPlugin(plugin) {
  for (const ext of plugin.extensions) {
    registry.set(ext.toLowerCase(), plugin);
  }
}

export function getPlugin(extension) {
  return registry.get(extension.toLowerCase()) ?? null;
}

export function getPluginById(id) {
  for (const plugin of new Set(registry.values())) {
    if (plugin.id === id) return plugin;
  }
  return null;
}

export function listRegisteredLanguages() {
  return [...new Set([...registry.values()].map((p) => p.id))];
}

// Register the built-in TypeScript/JavaScript plugin eagerly.
// Other plugins are lazy-loaded by the loader.
export async function initPlugins(languageIds = ["typescript"]) {
  for (const id of languageIds) {
    if (!getPluginById(id)) {
      try {
        const mod = await import(`./languages/${id}.js`);
        if (mod.default) registerPlugin(mod.default);
      } catch (err) {
        console.error(`[mneme] WARN could not load language plugin for ${id}: ${err.message}`);
      }
    }
  }
}
