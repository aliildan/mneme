import { recordMemory } from "../../memory/record.js";
import { interpolateEnv } from "../../config/mneme-config.js";

export async function handleRecordMemory(args, { db, config }) {
  const { kind, body, scope = "project", task, files, identifiers, tags } = args;
  const globalDbPath = interpolateEnv(config.memory?.globalDbPath ?? "$HOME/.openclaude/mneme/global.db");
  const result = await recordMemory(db, globalDbPath, { kind, body, scope, task, files, identifiers, tags });
  return result;
}
