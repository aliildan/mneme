import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOpus } from "../src/openclaude/models.js";

describe("Opus exclusion — isOpus()", () => {
  test("claude-opus-4 is recognized as opus", () => {
    assert.ok(isOpus("claude-opus-4"), "claude-opus-4 should be opus");
  });

  test("claude-opus-4-5 is recognized as opus", () => {
    assert.ok(isOpus("claude-opus-4-5"), "claude-opus-4-5 should be opus");
  });

  test("claude-opus-3 is recognized as opus", () => {
    assert.ok(isOpus("claude-opus-3"), "claude-opus-3 should be opus");
  });

  test("claude-haiku-4-5-20251001 is NOT opus", () => {
    assert.ok(!isOpus("claude-haiku-4-5-20251001"), "haiku should not be opus");
  });

  test("claude-sonnet-4-6 is NOT opus", () => {
    assert.ok(!isOpus("claude-sonnet-4-6"), "sonnet should not be opus");
  });

  test("ollama-local:qwen2.5-coder:7b is NOT opus", () => {
    assert.ok(!isOpus("ollama-local:qwen2.5-coder:7b"), "ollama model should not be opus");
  });

  test("empty string is NOT opus", () => {
    assert.ok(!isOpus(""), "empty string should not be opus");
  });
});

describe("Opus exclusion — listModels() filters opus from /v1/models response", () => {
  let server;
  let port;
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mneme-opus-test-"));
    await mkdir(join(tmpDir, "openclaude"), { recursive: true });

    server = await new Promise((resolve) => {
      const s = createServer((req, res) => {
        if (req.url === "/v1/models") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            data: [
              { id: "claude-opus-4-5-20251101", display_name: "Claude Opus 4.5" },
              { id: "claude-ol-claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
              { id: "claude-ol-claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
              { id: "claude-ol-ollama-local:llama3.2:3b", display_name: "Llama 3.2 3B" },
              { id: "claude-ol-claude-opus-3", display_name: "Claude Opus 3" },
            ],
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      s.listen(0, "127.0.0.1", () => {
        port = s.address().port;
        resolve(s);
      });
    });

    const config = { router: { baseUrl: `http://127.0.0.1:${port}` } };
    await writeFile(join(tmpDir, "openclaude", "mneme.json"), JSON.stringify(config));
    process.env.OPENCLAUDE_HOME = join(tmpDir, "openclaude");

    // Invalidate cache from other tests
    const { invalidateModelCache } = await import("../src/openclaude/models.js");
    invalidateModelCache();
  });

  after(async () => {
    delete process.env.OPENCLAUDE_HOME;
    await rm(tmpDir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  });

  test("listModels excludes all claude-opus-* entries", async () => {
    const { listModels, invalidateModelCache } = await import("../src/openclaude/models.js");
    invalidateModelCache();
    const options = await listModels({ refresh: true });

    const opusEntries = options.filter((m) => isOpus(m.id));
    assert.equal(opusEntries.length, 0, `Opus entries found in options: ${JSON.stringify(opusEntries.map((m) => m.id))}`);
  });

  test("listModels includes haiku and sonnet", async () => {
    const { listModels, invalidateModelCache } = await import("../src/openclaude/models.js");
    invalidateModelCache();
    const options = await listModels({ refresh: true });

    const ids = options.map((m) => m.id);
    assert.ok(ids.some((id) => id.includes("haiku")), `haiku not in options: ${JSON.stringify(ids)}`);
    assert.ok(ids.some((id) => id.includes("sonnet")), `sonnet not in options: ${JSON.stringify(ids)}`);
  });
});
