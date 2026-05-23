import { readFile, writeFile, unlink } from "node:fs/promises";
import { PID_FILE, LOG_FILE } from "../config/paths.js";

async function readPidFile() {
  try {
    const raw = await readFile(PID_FILE, "utf8");
    const pid = Number(raw.trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch { return null; }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function getDaemonStatus() {
  const pid = await readPidFile();
  if (pid && isAlive(pid)) return { running: true, pid, pidFile: PID_FILE, logFile: LOG_FILE };
  if (pid) await unlink(PID_FILE).catch(() => {});
  return { running: false, pid: null, pidFile: PID_FILE, logFile: LOG_FILE };
}

export async function stopDaemon() {
  const pid = await readPidFile();
  if (!pid) return { stopped: false, reason: "no pid file" };
  if (!isAlive(pid)) {
    await unlink(PID_FILE).catch(() => {});
    return { stopped: false, reason: "not running" };
  }
  try { process.kill(pid, "SIGTERM"); } catch {}
  await unlink(PID_FILE).catch(() => {});
  return { stopped: true, pid };
}

export async function writePidFile(pid) {
  await writeFile(PID_FILE, String(pid));
}

export const daemonPaths = { pidFile: PID_FILE, logFile: LOG_FILE };
