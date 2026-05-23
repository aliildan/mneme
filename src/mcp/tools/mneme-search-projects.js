import { federatedRecall } from "../../cross/federated-recall.js";
import { interpolateEnv } from "../../config/mneme-config.js";

export async function handleSearchProjects(args, { db, config }) {
  const { query, limit = 20 } = args;
  const globalDbPath = interpolateEnv(config.memory?.globalDbPath ?? "$HOME/.openclaude/mneme/global.db");
  const crossConfig = config.cross_project ?? { enabled: false, allow: [] };

  if (!crossConfig.enabled) {
    return { matches: [], info: "cross_project is disabled in mneme.json" };
  }

  const results = await federatedRecall({ query, limit, allowList: crossConfig.allow, globalDbPath });
  return { matches: results };
}
