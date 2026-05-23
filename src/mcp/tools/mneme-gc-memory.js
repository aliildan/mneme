import { gcMemory } from "../../memory/gc.js";
import { interpolateEnv } from "../../config/mneme-config.js";

export async function handleGcMemory(args, { db, config }) {
  const { older_than_days = 90 } = args;
  const globalDbPath = interpolateEnv(config.memory?.globalDbPath ?? "$HOME/.openclaude/mneme/global.db");
  const result = await gcMemory(db, globalDbPath, { olderThanDays: older_than_days });
  return result;
}
