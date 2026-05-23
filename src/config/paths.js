import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";

export const OPENCLAUDE_HOME = process.env.OPENCLAUDE_HOME || join(homedir(), ".openclaude");

export const MNEME_HOME = join(OPENCLAUDE_HOME, "mneme");
export const GLOBAL_DB_PATH = join(MNEME_HOME, "global.db");
export const PID_FILE = join(MNEME_HOME, "mneme.pid");
export const LOG_FILE = join(MNEME_HOME, "mneme.log");
export const DISCOVERY_ACTIVE_FILE = join(MNEME_HOME, "discovery-active");

export function projectDir(projectHash) {
  return join(MNEME_HOME, "projects", projectHash);
}

export function projectDbPath(projectHash) {
  return join(projectDir(projectHash), "index.db");
}

export function projectJsonPath(projectHash) {
  return join(projectDir(projectHash), "project.json");
}

export async function ensureMnemeHome() {
  await mkdir(MNEME_HOME, { recursive: true });
}

export async function ensureProjectDir(projectHash) {
  await mkdir(projectDir(projectHash), { recursive: true });
}
