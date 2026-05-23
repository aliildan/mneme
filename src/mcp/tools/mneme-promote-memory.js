import { promoteMemory } from "../../memory/promote.js";
import { interpolateEnv } from "../../config/mneme-config.js";

export async function handlePromoteMemory(args, { db, config }) {
  const { id } = args;
  const globalDbPath = interpolateEnv(config.memory?.globalDbPath ?? "$HOME/.openclaude/mneme/global.db");
  const result = await promoteMemory(db, globalDbPath, { id });
  return result;
}
