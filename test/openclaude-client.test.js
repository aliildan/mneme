import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server;
let port;
let lastRequest;
let tmpDir;
let responseOverride = null;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-client-test-"));
  await mkdir(join(tmpDir, "openclaude"), { recursive: true });

  server = await new Promise((resolve) => {
    const s = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          lastRequest = {
            method: req.method,
            url: req.url,
            headers: { ...req.headers },
            body: body ? JSON.parse(body) : null,
          };
        } catch {
          lastRequest = { method: req.method, url: req.url, headers: req.headers, body };
        }

        if (responseOverride) {
          const { status, data } = responseOverride;
          responseOverride = null;
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(data));
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            id: "msg_test",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: '{"keep":[1],"drop":[]}' }],
            model: "test-model",
            stop_reason: "end_turn",
          }));
        }
      });
    });

    s.listen(0, "127.0.0.1", () => {
      port = s.address().port;
      resolve(s);
    });
  });

  // Write a test config pointing to our fake server
  const config = {
    discoveryModel: null,
    router: { baseUrl: `http://127.0.0.1:${port}` },
  };
  await writeFile(join(tmpDir, "openclaude", "mneme.json"), JSON.stringify(config));

  // Point config loader at our temp dir
  process.env.OPENCLAUDE_HOME = join(tmpDir, "openclaude");
});

after(async () => {
  delete process.env.OPENCLAUDE_HOME;
  await rm(tmpDir, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
});

describe("openclaude HTTP client", () => {
  test("sends POST to /v1/messages with correct shape", async () => {
    const { callMessages } = await import("../src/openclaude/client.js");
    await callMessages({
      model: "ollama-local:qwen2.5-coder:7b",
      messages: [{ role: "user", content: "test" }],
      system: "you are a test",
      maxTokens: 256,
    });

    assert.equal(lastRequest.method, "POST");
    assert.equal(lastRequest.url, "/v1/messages");
    assert.ok(lastRequest.body, "no request body");
    assert.equal(lastRequest.body.model, "ollama-local:qwen2.5-coder:7b");
    assert.equal(lastRequest.body.max_tokens, 256);
    assert.equal(lastRequest.body.system, "you are a test");
    assert.equal(lastRequest.body.messages[0].role, "user");
  });

  test("sends sentinel Authorization header", async () => {
    const { callMessages } = await import("../src/openclaude/client.js");
    await callMessages({
      model: "test-model",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 10,
    });

    const auth = lastRequest.headers["authorization"];
    assert.ok(auth, "no Authorization header");
    assert.ok(auth.includes("oc-discovery-sentinel-do-not-store"), "sentinel not in auth header");
  });

  test("sends anthropic-version header", async () => {
    const { callMessages } = await import("../src/openclaude/client.js");
    await callMessages({
      model: "test-model",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 10,
    });

    assert.ok(lastRequest.headers["anthropic-version"], "no anthropic-version header");
  });

  test("throws on non-200 response", async () => {
    responseOverride = { status: 500, data: { error: "internal error" } };
    const { callMessages } = await import("../src/openclaude/client.js");
    await assert.rejects(
      () => callMessages({ model: "test-model", messages: [{ role: "user", content: "fail" }], maxTokens: 10 }),
      /router 500|openclaude router/
    );
  });

  test("respects AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    const { callMessages } = await import("../src/openclaude/client.js");
    await assert.rejects(
      () => callMessages({
        model: "test-model",
        messages: [{ role: "user", content: "abort" }],
        maxTokens: 10,
        signal: controller.signal,
      })
    );
  });

  test("returns parsed JSON response", async () => {
    const { callMessages } = await import("../src/openclaude/client.js");
    const result = await callMessages({
      model: "test-model",
      messages: [{ role: "user", content: "return" }],
      maxTokens: 100,
    });

    assert.ok(result.content, "no content in response");
    assert.ok(result.id, "no id in response");
  });
});
