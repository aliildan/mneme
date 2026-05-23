import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let baseDir;
let originalHome;
let settingsPath;

before(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "mneme-installhook-"));
  originalHome = process.env.HOME;
  process.env.HOME = baseDir;
  settingsPath = join(baseDir, ".claude", "settings.json");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await rm(baseDir, { recursive: true, force: true });
});

describe("installGlobalHook / uninstallGlobalHook", () => {
  test("install creates settings.json with mneme PostToolUse entry", async () => {
    const { installGlobalHook } = await import("../src/cli/install-hook.js");
    const r = await installGlobalHook();
    assert.equal(r.installed, true);

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const hooks = settings.hooks.PostToolUse;
    assert.ok(Array.isArray(hooks) && hooks.length === 1, "expected one PostToolUse entry");
    assert.equal(hooks[0].__mneme, "mneme-touch-on-read");
    assert.match(hooks[0].matcher, /Read/);
    assert.equal(hooks[0].hooks[0].command, "mneme touch 2>/dev/null || true");
  });

  test("install is idempotent on a fresh re-run", async () => {
    const { installGlobalHook } = await import("../src/cli/install-hook.js");
    const r = await installGlobalHook();
    assert.equal(r.installed, false);
    assert.equal(r.reason, "already-installed");

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(settings.hooks.PostToolUse.length, 1, "should still be exactly one entry");
  });

  test("install merges into existing settings without clobbering other hooks", async () => {
    // Manually wipe and pre-populate with a user-defined hook
    const userHook = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "echo user-hook-fired" }],
    };
    await mkdir(join(baseDir, ".claude"), { recursive: true });
    await writeFile(settingsPath, JSON.stringify({
      hooks: { PostToolUse: [userHook] },
    }, null, 2));

    const { installGlobalHook } = await import("../src/cli/install-hook.js");
    const r = await installGlobalHook();
    assert.equal(r.installed, true);

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const hooks = settings.hooks.PostToolUse;
    assert.equal(hooks.length, 2);
    assert.ok(hooks.find((h) => h.matcher === "Bash"), "user hook should be preserved");
    assert.ok(hooks.find((h) => h.__mneme === "mneme-touch-on-read"), "mneme hook should be present");
  });

  test("uninstall removes only the mneme entry", async () => {
    const { uninstallGlobalHook } = await import("../src/cli/install-hook.js");
    const r = await uninstallGlobalHook();
    assert.equal(r.removed, true);

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const hooks = settings.hooks.PostToolUse;
    assert.equal(hooks.length, 1, "user hook should remain");
    assert.equal(hooks[0].matcher, "Bash");
    assert.ok(!hooks.find((h) => h.__mneme), "no mneme entries should remain");
  });

  test("uninstall reports not-installed when entry is absent", async () => {
    const { uninstallGlobalHook } = await import("../src/cli/install-hook.js");
    const r = await uninstallGlobalHook();
    assert.equal(r.removed, false);
    assert.equal(r.reason, "not-installed");
  });
});
