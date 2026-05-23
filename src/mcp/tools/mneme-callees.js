import { queryGraph } from "../../graph/queries.js";

export async function handleCallees(args, { db }) {
  const { symbol, file, hops = 2 } = args;
  const results = queryGraph(db, symbol, file, hops, "callees");
  return { results };
}
