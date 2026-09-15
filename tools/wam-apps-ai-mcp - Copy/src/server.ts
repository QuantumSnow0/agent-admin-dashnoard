import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  resolveActorFromConfig,
  type AppConfig,
  type ActorContext,
} from "./config.js";
import type { DbClient } from "./db.js";
import {
  executeBusinessTool,
  listBusinessTools,
  parseToolName,
  TOOL_NAMESPACE,
} from "./tools.js";
import { TOOL_SCHEMAS, type ToolName } from "./validation.js";

/** Reject caller-supplied SQL / query payloads (never executed). */
export function argsContainForbiddenSql(args: Record<string, unknown>): boolean {
  return "sql" in args || "query" in args || "rawSql" in args;
}

/**
 * Actor identity is instance-bound from config only.
 * Conversation text, tool arguments, and model meta MUST NEVER elevate privileges.
 * @deprecated Prefer resolveActorFromConfig — meta is ignored.
 */
export function resolveActor(
  cfg: AppConfig,
  _meta?: Record<string, unknown> | null,
): ActorContext {
  void _meta;
  return resolveActorFromConfig(cfg);
}

export function createMcpServer(cfg: AppConfig, db: DbClient): Server {
  const server = new Server(
    { name: "wam-business-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (cfg.killSwitch) {
      return { tools: [] };
    }
    return {
      tools: listBusinessTools().map((t) => {
        const short = parseToolName(t.name) as ToolName;
        return {
          name: t.name,
          description: t.description,
          inputSchema: TOOL_SCHEMAS[short],
        };
      }),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const fullName = request.params.name;
    const tool = parseToolName(fullName);
    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: {
                category: "denied",
                message: "That capability is not available in your WAM APPS AI workspace.",
              },
            }),
          },
        ],
        isError: true,
      };
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    if (argsContainForbiddenSql(args)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: { category: "denied", message: "Arbitrary SQL is not allowed" },
            }),
          },
        ],
        isError: true,
      };
    }

    // Identity from instance binding only — never from args/meta.
    const actor = resolveActorFromConfig(cfg);
    const result = await executeBusinessTool({
      tool,
      args,
      cfg,
      db,
      actor,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ...result,
            tool: `${TOOL_NAMESPACE}.${tool}`,
          }),
        },
      ],
      isError: !result.ok,
    };
  });

  return server;
}

export async function startStdioServer(cfg: AppConfig, db: DbClient): Promise<void> {
  const server = createMcpServer(cfg, db);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
