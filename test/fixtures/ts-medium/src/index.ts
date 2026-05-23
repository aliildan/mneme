import { loadConfig, validateConfig } from "./config.js";
import { Database } from "./db.js";
import { appEvents } from "./events.js";
import { Cache } from "./cache.js";

export { loadConfig, validateConfig, Database, appEvents, Cache };

export async function bootstrap() {
  const cfg = loadConfig();
  const errors = validateConfig(cfg);
  if (errors.length) throw new Error(`Invalid config: ${errors.join(", ")}`);

  const db = new Database(cfg.database);
  await db.connect();

  const cache = new Cache({ defaultTtlMs: 60_000, maxSize: 1000 });

  appEvents.emit("user:login", { userId: "system", timestamp: Date.now() });

  return { cfg, db, cache };
}
