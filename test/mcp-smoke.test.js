import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "..", "src", "mcp", "server.js");

let tmpDir;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mneme-mcp-smoke-"));
  await mkdir(join(tmpDir, "src"));
  await writeFile(join(tmpDir, "src", "hello.ts"), "export function hello() { return 'world'; }");
  await writeFile(join(tmpDir, "package.json"), JSON.stringify({ name: "smoke-test", type: "module" }));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// MCP SDK uses newline-delimited JSON (not Content-Length framing)
function sendRequest(proc, msg) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const onData = (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) return;
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      proc.stdout.off("data", onData);
      try {
        const parsed = JSON.parse(line);
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse response: ${line}`));
      }
    };

    proc.stdout.on("data", onData);
    proc.stdin.write(JSON.stringify(msg) + "\n");

    setTimeout(() => {
      proc.stdout.off("data", onData);
      reject(new Error("Timeout waiting for MCP response"));
    }, 8000);
  });
}

describe("MCP server smoke test", () => {
  let proc;

  before(() => {
    proc = spawn("node", [SERVER], {
      env: { ...process.env, MNEME_PROJECT_ROOT: tmpDir, MNEME_QUIET: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stderr.on("data", () => {}); // suppress stderr

    return new Promise((resolve, reject) => {
      proc.on("error", reject);
      // Give server time to start
      setTimeout(resolve, 800);
    });
  });

  after(() => {
    if (proc && !proc.killed) {
      proc.kill();
    }
  });

  test("initialize handshake returns server info", async () => {
    const response = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0" },
      },
    });

    assert.equal(response.jsonrpc, "2.0");
    assert.equal(response.id, 1);
    assert.ok(response.result, "expected result");
    assert.ok(response.result.serverInfo, "expected serverInfo");
    assert.ok(response.result.serverInfo.name, "expected server name");
  });

  test("tools/list returns expected tools", async () => {
    // Send initialized notification first
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

    const response = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    assert.equal(response.id, 2);
    assert.ok(response.result, "expected result");
    assert.ok(Array.isArray(response.result.tools), "expected tools array");

    const toolNames = response.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes("mneme_get_context"), "mneme_get_context missing");
    assert.ok(toolNames.includes("mneme_lookup_symbol"), "mneme_lookup_symbol missing");
    assert.ok(toolNames.includes("mneme_index_status"), "mneme_index_status missing");
    assert.ok(toolNames.includes("mneme_record_memory"), "mneme_record_memory missing");
    assert.ok(toolNames.includes("mneme_recall_memory"), "mneme_recall_memory missing");
  });

  test("oversize task is rejected with an error payload", async () => {
    const huge = "x".repeat(8000);
    const response = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: {
        name: "mneme_get_context",
        arguments: { task: huge },
      },
    });

    assert.equal(response.id, 99);
    assert.ok(response.result, "expected result envelope");
    assert.equal(response.result.isError, true, "expected isError: true for oversize task");

    const textBlock = response.result.content.find((c) => c.type === "text");
    const parsed = JSON.parse(textBlock.text);
    assert.ok(/maxLength|exceeds/.test(parsed.error ?? ""), `expected length error, got: ${parsed.error}`);
  });

  test("mneme_index_status tool call returns project info", async () => {
    const response = await sendRequest(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "mneme_index_status",
        arguments: {},
      },
    });

    assert.equal(response.id, 3);
    assert.ok(response.result, "expected result");
    assert.ok(!response.error, `unexpected error: ${JSON.stringify(response.error)}`);

    const content = response.result.content;
    assert.ok(Array.isArray(content) && content.length > 0, "expected content array");

    const textBlock = content.find((c) => c.type === "text");
    assert.ok(textBlock, "expected text block in content");

    const parsed = JSON.parse(textBlock.text);
    assert.ok(parsed.project_root !== undefined || parsed.schema_version !== undefined, "expected status fields");
  });
});
