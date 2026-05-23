import { listModels } from "../../openclaude/models.js";

export async function handleListModels(args, { config }) {
  const { refresh = false } = args;
  const options = await listModels({ refresh });
  return {
    current: config.discoveryModel ?? null,
    options: options.map((m, i) => ({ n: i + 1, ...m })),
  };
}
