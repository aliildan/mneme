import { realpathSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export function projectHash(absoluteRoot) {
  const norm = realpathSync(absoluteRoot);
  // Length-prefix prevents "/a/bc" vs "/ab/c" collisions.
  const tagged = `mneme:v1:${norm.length}:${norm}`;
  const bytes = new TextEncoder().encode(tagged);
  return bytesToHex(sha256(bytes)).slice(0, 16);
}
