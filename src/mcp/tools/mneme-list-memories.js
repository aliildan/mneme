import { listMemories } from "../../memory/recall.js";
import { interpolateEnv } from "../../config/mneme-config.js";

export async function handleListMemories(args, { db, config }) {
  const { scope = "any", kind = "any", limit = 20, offset = 0 } = args;
  const globalDbPath = interpolateEnv(config.memory?.globalDbPath ?? "$HOME/.openclaude/mneme/global.db");
  const memories = await listMemories(db, globalDbPath, { scope, kind, limit, offset });
  return { memories, offset, limit };
}
