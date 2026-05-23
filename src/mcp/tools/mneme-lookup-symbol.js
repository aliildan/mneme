import { lookupSymbol } from "../../retrieval/pack.js";

export async function handleLookupSymbol(args, { db, projectRoot }) {
  const { name, kind = "any", limit = 20 } = args;
  const matches = await lookupSymbol(db, projectRoot, { name, kind, limit });
  return { matches };
}
