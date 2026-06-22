import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let baseDir, originalHome, settingsPath;

before(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "mneme-sshook-"));
  originalHome = process.env.HOME;
  process.env.HOME = baseDir;
  settingsPath = join(baseDir, ".claude", "settings.json");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  await rm(baseDir, { recursive: true, force: true });
});

describe("installSessionStartHook / uninstallSessionStartHook", () => {
  test("install creates a SessionStart entry running session-context", async () => {
    const { installSessionStartHook } = await import("../src/cli/install-hook.js");
    const r = await installSessionStartHook();
    assert.equal(r.installed, true);
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const hooks = settings.hooks.SessionStart;
    assert.ok(Array.isArray(hooks) && hooks.length === 1);
    assert.equal(hooks[0].__mneme, "mneme-session-context");
    assert.match(hooks[0].hooks[0].command, /mneme session-context/);
  });

  test("install is idempotent", async () => {
    const { installSessionStartHook } = await import("../src/cli/install-hook.js");
    const r = await installSessionStartHook();
    assert.equal(r.installed, false);
    assert.equal(r.reason, "already-installed");
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(settings.hooks.SessionStart.length, 1);
  });

  test("uninstall removes only the mneme SessionStart entry", async () => {
    // pre-seed a user SessionStart hook
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: "echo user" }] });
    await mkdir(join(baseDir, ".claude"), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));

    const { uninstallSessionStartHook } = await import("../src/cli/install-hook.js");
    const r = await uninstallSessionStartHook();
    assert.equal(r.removed, true);
    const after = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(after.hooks.SessionStart.length, 1);
    assert.ok(!after.hooks.SessionStart.find((h) => h?.__mneme));
  });
});
