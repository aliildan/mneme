import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let baseDir;
let projectRoot;
let originalEnv;

before(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "mneme-touch-"));
  projectRoot = join(baseDir, "project");
  await mkdir(projectRoot);
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "touch-test" }));

  originalEnv = {
    OPENCLAUDE_HOME: process.env.OPENCLAUDE_HOME,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
  };
  process.env.OPENCLAUDE_HOME = join(baseDir, "openclaude");
  process.env.CLAUDE_PROJECT_DIR = projectRoot;
});

after(async () => {
  if (originalEnv.OPENCLAUDE_HOME === undefined) delete process.env.OPENCLAUDE_HOME;
  else process.env.OPENCLAUDE_HOME = originalEnv.OPENCLAUDE_HOME;
  if (originalEnv.CLAUDE_PROJECT_DIR === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = originalEnv.CLAUDE_PROJECT_DIR;

  await rm(baseDir, { recursive: true, force: true });
});

describe("mneme touch", () => {
  test("writes a .dirty marker under the project dir", async () => {
    // Late imports so OPENCLAUDE_HOME is honored at module-load time
    const { touch } = await import("../src/cli/commands/touch.js");
    const { projectHash } = await import("../src/project/project-hash.js");
    const { projectDir } = await import("../src/config/paths.js");

    await touch();

    const hash = projectHash(projectRoot);
    const dirtyFile = join(projectDir(hash), ".dirty");
    await access(dirtyFile);
    const contents = await readFile(dirtyFile, "utf8");
    assert.ok(Number(contents) > 0, `expected timestamp in .dirty, got: ${contents}`);
  });
});
