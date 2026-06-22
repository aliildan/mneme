import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let projRoot;
before(async () => { projRoot = await mkdtemp(join(tmpdir(), "mneme-skill-")); });
after(async () => { await rm(projRoot, { recursive: true, force: true }); });

describe("installSkill", () => {
  test("copies SKILL.md into .claude/skills/mneme with frontmatter", async () => {
    const { installSkill } = await import("../src/cli/commands/install-skill.js");
    await installSkill(projRoot);
    const content = await readFile(join(projRoot, ".claude", "skills", "mneme", "SKILL.md"), "utf8");
    assert.match(content, /^---/);
    assert.match(content, /name:\s*mneme/);
    assert.match(content, /mneme_get_context/);
  });
});
