import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";

const enc = new TextEncoder();

// Hash includes path bytes so renames don't preserve the leaf hash.
export function hashFileContent(relPath, fileBytes) {
  const pathBytes = enc.encode(relPath);
  const sep = new Uint8Array([0]);
  const hasher = blake3.create({});
  hasher.update(pathBytes);
  hasher.update(sep);
  hasher.update(fileBytes);
  return bytesToHex(hasher.digest());
}

export function hashString(str) {
  return bytesToHex(blake3(enc.encode(str)));
}

export function hashBytes(bytes) {
  return bytesToHex(blake3(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
}
