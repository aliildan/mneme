import { readFile, stat, opendir } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { hashFileContent, hashString } from "./content-hash.js";
import { buildIgnoreFilter } from "./ignore.js";
import { listDir } from "./walker.js";
import { getStmts } from "../db/statements.js";

// Build a directory-node hash from its sorted children.
export function buildDirHash(relPath, childEntries) {
  // childEntries: [{ kind, name, hash }] sorted by name
  const lines = childEntries.map((e) => `${e.kind}\t${e.name}\t${e.hash}`);
  return hashString(relPath + "\n" + lines.join("\n"));
}

// Lazy validation: walk the Merkle tree, find changed files.
// Returns { dirty: Set<relPath>, removed: Set<relPath>, newRootHash, newHashes }.
export async function validateLazily(db, projectRoot, { maxFileBytes = 1048576, ignore: extraIgnore = [] } = {}) {
  const stmts = getStmts(db);
  const filter = await buildIgnoreFilter(projectRoot, extraIgnore);
  const dirty = new Set();
  const removed = new Set();
  const newHashes = new Map(); // relPath → hash

  async function processDir(absDir, relDir) {
    const current = await listDir(absDir, projectRoot, filter);

    const cachedChildren = stmts.getMerkleChildren.all(relDir);
    const cachedMap = new Map(cachedChildren.map((c) => [c.rel_path, c]));
    const currentSet = new Set(current.map((e) => e.relPath));

    // Detect removed entries from the cache
    for (const cached of cachedChildren) {
      if (!currentSet.has(cached.rel_path)) {
        if (cached.kind === "file") removed.add(cached.rel_path);
      }
    }

    // Recurse into subdirs first (bottom-up)
    for (const ent of current) {
      if (ent.kind === "dir") {
        await processDir(join(absDir, ent.name), ent.relPath);
      }
    }

    // Compute child hashes for this dir
    const childEntries = [];

    for (const ent of current) {
      if (ent.kind === "dir") {
        const dirHash = newHashes.get(ent.relPath) ?? "";
        childEntries.push({ kind: "dir", name: ent.name, hash: dirHash });
      } else {
        // file: try fast accept via mtime+size, then fall back to hash
        const absPath = join(projectRoot, ent.relPath);
        let fileHash;
        const cachedNode = cachedMap.get(ent.relPath);

        try {
          const info = await stat(absPath);
          let reused = false;

          if (cachedNode && cachedNode.kind === "file") {
            // Fast accept: if mtime and size match what the files table recorded, reuse cached hash.
            // We store mtime in files.mtime_ms; if missing there, fall through to hash.
            const fileRow = stmts.getFileByPath.get(ent.relPath);
            if (
              fileRow &&
              Math.floor(info.mtimeMs) === fileRow.mtime_ms &&
              info.size === fileRow.size_bytes
            ) {
              fileHash = cachedNode.hash;
              reused = true;
            }
          }

          if (!reused) {
            // Compute actual content hash
            const bytes = await readFile(absPath);
            fileHash = hashFileContent(ent.relPath, bytes);
            // Mark dirty if hash changed relative to last known merkle leaf hash
            if (!cachedNode || cachedNode.hash !== fileHash) {
              dirty.add(ent.relPath);
            }
          }
        } catch {
          dirty.add(ent.relPath);
          fileHash = "error";
        }
        childEntries.push({ kind: "file", name: ent.name, hash: fileHash });
        newHashes.set(ent.relPath, fileHash);
      }
    }

    const dirHash = buildDirHash(relDir, childEntries);
    newHashes.set(relDir, dirHash);

    // Pruning: if this dir's hash matches the cached hash, undo any dirty marks
    // for entries in this subtree (they were falsely marked before we computed the dir hash).
    // This optimization only works post-recurse; we check after the full subtree is done.
    const cachedDirNode = stmts.getMerkleNode.get(relDir);
    if (cachedDirNode && cachedDirNode.hash === dirHash) {
      // Remove dirty entries that are children of this dir
      for (const d of [...dirty]) {
        const parentRel = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "";
        if (parentRel === relDir || d.startsWith(relDir + "/")) {
          dirty.delete(d);
        }
      }
    }
  }

  await processDir(projectRoot, "");

  const newRootHash = newHashes.get("") ?? "";
  return { dirty, removed, newRootHash, newHashes };
}

// Persist updated merkle nodes to the DB after a validation pass.
export function persistMerkle(db, newHashes, removedRelPaths, now = Date.now()) {
  const stmts = getStmts(db);
  for (const rel of removedRelPaths) {
    stmts.deleteMerkleNode.run(rel);
  }

  // Determine which paths are dirs vs files:
  // A path is a dir if it appears as a prefix of another path OR is the root ("").
  const dirSet = new Set();
  dirSet.add(""); // root is always a dir
  for (const relPath of newHashes.keys()) {
    if (relPath === "") continue;
    const parent = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
    // If this path has child paths, it's a dir — detect by checking if any key starts with it + "/"
    for (const other of newHashes.keys()) {
      if (other !== relPath && other.startsWith(relPath + "/")) {
        dirSet.add(relPath);
        break;
      }
    }
    // Also add parent
    dirSet.add(parent);
  }

  for (const [relPath, hash] of newHashes) {
    const kind = dirSet.has(relPath) ? "dir" : "file";
    const parent = relPath === "" ? "" : (relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "");
    stmts.upsertMerkleNode.run(relPath, kind, hash, parent, now);
  }
}
