import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { detectRoot } from "../project/detect-root.js";
import { projectHash } from "../project/project-hash.js";
import { projectDbPath, ensureProjectDir } from "../config/paths.js";
import { openProjectDb } from "../db/open.js";
import { migrateProjectDb } from "../db/migrate.js";
import { loadConfig } from "../config/mneme-config.js";
import { ensureFresh } from "../index/validator.js";
import { ensureLogDir, log } from "../util/logger.js";

// Tool handlers
import { handleGetContext } from "./tools/mneme-get-context.js";
import { handleLookupSymbol } from "./tools/mneme-lookup-symbol.js";
import { handleIndexStatus } from "./tools/mneme-index-status.js";
import { handleRecordMemory } from "./tools/mneme-record-memory.js";
import { handleRecallMemory } from "./tools/mneme-recall-memory.js";
import { handleListMemories } from "./tools/mneme-list-memories.js";
import { handleForgetMemory } from "./tools/mneme-forget.js";
import { handleListModels } from "./tools/mneme-list-models.js";
import { handleSetDiscoveryModel } from "./tools/mneme-set-discovery-model.js";
import { handleRecordOutcome } from "./tools/mneme-record-outcome.js";
import { handleCallers } from "./tools/mneme-callers.js";
import { handleCallees } from "./tools/mneme-callees.js";
import { handleSearchProjects } from "./tools/mneme-search-projects.js";
import { handleGcMemory } from "./tools/mneme-gc-memory.js";
import { handlePromoteMemory } from "./tools/mneme-promote-memory.js";

const TOOLS = [
  {
    name: "mneme_get_context",
    description: "Retrieve ranked code context (symbols + snippets) for a task. Validates the symbol index first.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string", maxLength: 4000, description: "What the agent is trying to do, in its own words." },
        hint: { type: "string", maxLength: 2000, description: "Optional file path, identifier, or error string." },
        token_budget: { type: "integer", minimum: 500, maximum: 50000, default: 6000 },
        use_discovery_model: { type: "boolean", default: true },
      },
    },
    handler: handleGetContext,
  },
  {
    name: "mneme_lookup_symbol",
    description: "Look up symbols by name in the project index.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", maxLength: 256 },
        kind: { type: "string", enum: ["any", "function", "class", "method", "interface", "type", "enum", "const"], default: "any" },
        limit: { type: "integer", default: 20 },
      },
    },
    handler: handleLookupSymbol,
  },
  {
    name: "mneme_index_status",
    description: "Show current index health, row counts, and configuration.",
    inputSchema: { type: "object", properties: {} },
    handler: handleIndexStatus,
  },
  {
    name: "mneme_record_memory",
    description: "Store a verbatim decision, learning, gotcha, or todo. Body must be exact text — never paraphrased.",
    inputSchema: {
      type: "object",
      required: ["kind", "body"],
      properties: {
        kind: { type: "string", enum: ["decision", "learning", "gotcha", "todo"] },
        body: { type: "string", minLength: 1, maxLength: 16000 },
        scope: { type: "string", enum: ["project", "global"], default: "project" },
        task: { type: "string", maxLength: 4000 },
        files: { type: "array", maxItems: 64, items: { type: "string", maxLength: 256 } },
        identifiers: { type: "array", maxItems: 64, items: { type: "string", maxLength: 256 } },
        tags: { type: "array", maxItems: 64, items: { type: "string", maxLength: 256 } },
      },
    },
    handler: handleRecordMemory,
  },
  {
    name: "mneme_recall_memory",
    description: "Search project and global memory by query text, kind, scope, files, or tags.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 1000 },
        kind: { type: "string", enum: ["any", "decision", "learning", "gotcha", "todo"], default: "any" },
        scope: { type: "string", enum: ["any", "project", "global"], default: "any" },
        files: { type: "array", maxItems: 64, items: { type: "string", maxLength: 256 } },
        tags: { type: "array", maxItems: 64, items: { type: "string", maxLength: 256 } },
        limit: { type: "integer", default: 20 },
      },
    },
    handler: handleRecallMemory,
  },
  {
    name: "mneme_list_memories",
    description: "Paginate through stored memories without scoring.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["any", "project", "global"], default: "any" },
        kind: { type: "string", enum: ["any", "decision", "learning", "gotcha", "todo"], default: "any" },
        limit: { type: "integer", default: 20 },
        offset: { type: "integer", default: 0 },
      },
    },
    handler: handleListMemories,
  },
  {
    name: "mneme_forget",
    description: "Soft-delete a memory by id. The body is preserved for audit; it is never returned in future recall.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "integer" } },
    },
    handler: handleForgetMemory,
  },
  {
    name: "mneme_list_models",
    description: "List available discovery models (Ollama + curated Anthropic, excluding Opus).",
    inputSchema: {
      type: "object",
      properties: { refresh: { type: "boolean", default: false } },
    },
    handler: handleListModels,
  },
  {
    name: "mneme_set_discovery_model",
    description: "Set the discovery model used for candidate narrowing. Pass null to unset.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: ["string", "null"], maxLength: 256 } },
    },
    handler: handleSetDiscoveryModel,
  },
  {
    name: "mneme_record_outcome",
    description: "Record whether a mneme_get_context call succeeded. Closes the metrics feedback loop.",
    inputSchema: {
      type: "object",
      required: ["context_id", "outcome"],
      properties: {
        context_id: { type: "string", maxLength: 64 },
        outcome: { type: "string", enum: ["success", "failure", "partial"] },
        notes: { type: "string", maxLength: 4000 },
        tokens_used: { type: "integer" },
      },
    },
    handler: handleRecordOutcome,
  },
  {
    name: "mneme_callers",
    description: "Find callers of a symbol (N-hop dependency graph traversal).",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", maxLength: 256 },
        file: { type: "string", maxLength: 1024 },
        hops: { type: "integer", minimum: 1, maximum: 5, default: 2 },
      },
    },
    handler: handleCallers,
  },
  {
    name: "mneme_callees",
    description: "Find callees of a symbol (N-hop dependency graph traversal).",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", maxLength: 256 },
        file: { type: "string", maxLength: 1024 },
        hops: { type: "integer", minimum: 1, maximum: 5, default: 2 },
      },
    },
    handler: handleCallees,
  },
  {
    name: "mneme_search_projects",
    description: "Search memory across opted-in projects (memory only — never symbols).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 1000 },
        limit: { type: "integer", default: 20 },
      },
    },
    handler: handleSearchProjects,
  },
  {
    name: "mneme_gc_memory",
    description: "Soft-delete stale memories (manual only — never time-triggered).",
    inputSchema: {
      type: "object",
      properties: { older_than_days: { type: "integer", default: 90 } },
    },
    handler: handleGcMemory,
  },
  {
    name: "mneme_promote_memory",
    description: "Explicitly promote a project-local memory to global scope.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "integer" } },
    },
    handler: handlePromoteMemory,
  },
];

function checkInputLimits(args, schema) {
  const props = schema?.properties ?? {};
  for (const [key, spec] of Object.entries(props)) {
    const value = args[key];
    if (value == null) continue;
    if (spec.maxLength != null && typeof value === "string" && value.length > spec.maxLength) {
      return `${key} exceeds maxLength ${spec.maxLength} (got ${value.length})`;
    }
    if (spec.maxItems != null && Array.isArray(value) && value.length > spec.maxItems) {
      return `${key} exceeds maxItems ${spec.maxItems} (got ${value.length})`;
    }
    if (Array.isArray(value) && spec.items?.maxLength != null) {
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === "string" && value[i].length > spec.items.maxLength) {
          return `${key}[${i}] exceeds maxLength ${spec.items.maxLength}`;
        }
      }
    }
  }
  return null;
}

export async function startMcpServer() {
  await ensureLogDir();
  log.info("Starting Mneme MCP server");

  const projectRoot = await detectRoot();
  const hash = projectHash(projectRoot);
  const dbPath = projectDbPath(hash);

  await ensureProjectDir(hash);
  const db = await openProjectDb(hash, dbPath);
  migrateProjectDb(db);

  // Store project info in meta
  const stmts = (await import("../db/statements.js")).getStmts(db);
  stmts.setMeta.run("project_root", projectRoot);
  stmts.setMeta.run("project_hash", hash);
  if (!stmts.getMeta.get("created_at")) {
    stmts.setMeta.run("created_at", String(Date.now()));
  }

  log.info(`Project: ${projectRoot} (hash: ${hash})`);

  const server = new Server(
    { name: "mneme", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  const ctx = { db, dbPath, projectRoot, hash };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    // Enforce maxLength/maxItems from inputSchema (low-level SDK does not).
    const violation = checkInputLimits(args ?? {}, tool.inputSchema);
    if (violation) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: violation }) }],
        isError: true,
      };
    }

    // Hot-reload config on every call
    const config = await loadConfig();

    // Validate index on tools that read symbols/context
    const needsFresh = ["mneme_get_context", "mneme_lookup_symbol", "mneme_index_status",
                        "mneme_callers", "mneme_callees"];
    let validation = null;
    if (needsFresh.includes(name)) {
      validation = await ensureFresh(db, projectRoot, { config });
    }

    try {
      const result = await tool.handler(args ?? {}, { ...ctx, config, validation });
      return {
        content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      log.error(`Tool ${name} failed: ${err.message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("Mneme MCP server ready");
}

// Auto-start when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startMcpServer().catch((err) => {
    console.error("[mneme] fatal:", err.message);
    process.exit(1);
  });
}
