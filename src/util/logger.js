import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { MNEME_HOME, LOG_FILE } from "../config/paths.js";

const QUIET = !!process.env.MNEME_QUIET;

let stream = null;

function getStream() {
  if (stream) return stream;
  stream = createWriteStream(LOG_FILE, { flags: "a" });
  stream.on("error", () => { stream = null; });
  return stream;
}

function write(level, msg) {
  const line = `[mneme] ${new Date().toISOString()} ${level} ${msg}\n`;
  try { getStream().write(line); } catch {}
  if (!QUIET || level === "ERROR") process.stderr.write(line);
}

export async function ensureLogDir() {
  await mkdir(MNEME_HOME, { recursive: true });
}

export const log = {
  info:  (msg) => write("INFO ", msg),
  warn:  (msg) => write("WARN ", msg),
  error: (msg) => write("ERROR", msg),
  debug: (msg) => { if (process.env.MNEME_DEBUG) write("DEBUG", msg); },
};
