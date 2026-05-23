import { queryGraph } from "../../graph/queries.js";

export async function handleCallers(args, { db }) {
  const { symbol, file, hops = 2 } = args;
  const results = queryGraph(db, symbol, file, hops, "callers");
  return { results };
}
