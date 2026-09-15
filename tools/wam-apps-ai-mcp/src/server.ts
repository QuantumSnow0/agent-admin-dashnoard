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
import type { ActionDbClient } from "./actionDb.js";
import {
  executeBusinessTool,
  listBusinessTools,
  parseToolName,
  TOOL_NAMESPACE,
} from "./tools.js";
import {
  executeDispatchTool,
  listDispatchTools,
  parseDispatchToolName,
  DISPATCH_TOOL_NAMESPACE,
} from "./tools-dispatch.js";
import {
  executeOperationsTool,
  listOperationsTools,
  parseOperationsToolName,
  OPERATIONS_TOOL_NAMESPACE,
} from "./tools-operations.js";
import {
  executeActionTool,
  listActionTools,
  parseActionToolName,
  fullActionToolName,
} from "./tools-actions.js";
import {
  ACTION_TOOL_SCHEMAS,
  ACTION_TOOL_NAMESPACE_BY_NAME,
  type ActionToolName,
} from "./validation-actions.js";
import { TOOL_SCHEMAS, type ToolName } from "./validation.js";
import {
  DISPATCH_TOOL_SCHEMAS,
  type DispatchToolName,
} from "./validation-dispatch.js";
import {
  executeNotificationTool,
  listNotificationTools,
  parseNotificationToolName,
  NOTIFICATIONS_NAMESPACE,
} from "./tools-notifications.js";
import {
  NOTIFICATION_TOOL_SCHEMAS,
  type NotificationToolName,
} from "./validation-notifications.js";
import {
  executeSmsTool,
  listSmsTools,
  parseSmsToolName,
  MESSAGING_NAMESPACE,
} from "./tools-sms.js";
import {
  SMS_TOOL_SCHEMAS,
  type SmsToolName,
} from "./validation-sms.js";
import {
  executeIntelligenceTool,
  listIntelligenceTools,
  parseIntelligenceToolName,
  INTELLIGENCE_NAMESPACE,
} from "./tools-intelligence.js";
import {
  INTELLIGENCE_TOOL_SCHEMAS,
  type IntelligenceToolName,
} from "./validation-intelligence.js";
import {
  executeDocumentTool,
  listDocumentTools,
  parseDocumentToolName,
  DOCUMENTS_NAMESPACE,
} from "./tools-documents.js";
import {
  DOCUMENT_TOOL_SCHEMAS,
  type DocumentToolName,
} from "./validation-documents.js";
import {
  executeQueryTool,
  listQueryTools,
  parseQueryToolName,
  QUERY_NAMESPACE,
} from "./tools-query.js";
import {
  QUERY_TOOL_SCHEMAS,
  type QueryToolName,
} from "./validation-query.js";
import {
  OPERATIONS_TOOL_SCHEMAS,
  type OperationsToolName,
} from "./validation-operations.js";

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

export type ParsedMcpTool =
  | { kind: "analytics"; tool: ToolName; namespace: typeof TOOL_NAMESPACE }
  | {
      kind: "operations";
      tool: OperationsToolName;
      namespace: typeof OPERATIONS_TOOL_NAMESPACE;
    }
  | {
      kind: "dispatch";
      tool: DispatchToolName;
      namespace: typeof DISPATCH_TOOL_NAMESPACE;
    }
  | {
      kind: "action";
      tool: ActionToolName;
      namespace: string;
    }
  | {
      kind: "notifications";
      tool: NotificationToolName;
      namespace: typeof NOTIFICATIONS_NAMESPACE;
    }
  | {
      kind: "messaging";
      tool: SmsToolName;
      namespace: typeof MESSAGING_NAMESPACE;
    }
  | {
      kind: "intelligence";
      tool: IntelligenceToolName;
      namespace: typeof INTELLIGENCE_NAMESPACE;
    }
  | {
      kind: "documents";
      tool: DocumentToolName;
      namespace: typeof DOCUMENTS_NAMESPACE;
    }
  | {
      kind: "query";
      tool: QueryToolName;
      namespace: typeof QUERY_NAMESPACE;
    };

export function parseAnyToolName(full: string): ParsedMcpTool | null {
  const analytics = parseToolName(full);
  if (analytics) {
    return { kind: "analytics", tool: analytics, namespace: TOOL_NAMESPACE };
  }
  const dispatch = parseDispatchToolName(full);
  if (dispatch) {
    return {
      kind: "dispatch",
      tool: dispatch,
      namespace: DISPATCH_TOOL_NAMESPACE,
    };
  }
  const operations = parseOperationsToolName(full);
  if (operations) {
    return {
      kind: "operations",
      tool: operations,
      namespace: OPERATIONS_TOOL_NAMESPACE,
    };
  }
  const action = parseActionToolName(full);
  if (action) {
    return {
      kind: "action",
      tool: action,
      namespace: ACTION_TOOL_NAMESPACE_BY_NAME[action],
    };
  }
  const notifications = parseNotificationToolName(full);
  if (notifications) {
    return {
      kind: "notifications",
      tool: notifications,
      namespace: NOTIFICATIONS_NAMESPACE,
    };
  }
  const messaging = parseSmsToolName(full);
  if (messaging) {
    return {
      kind: "messaging",
      tool: messaging,
      namespace: MESSAGING_NAMESPACE,
    };
  }
  const intelligence = parseIntelligenceToolName(full);
  if (intelligence) {
    return {
      kind: "intelligence",
      tool: intelligence,
      namespace: INTELLIGENCE_NAMESPACE,
    };
  }
  const documents = parseDocumentToolName(full);
  if (documents) {
    return {
      kind: "documents",
      tool: documents,
      namespace: DOCUMENTS_NAMESPACE,
    };
  }
  const query = parseQueryToolName(full);
  if (query) {
    return {
      kind: "query",
      tool: query,
      namespace: QUERY_NAMESPACE,
    };
  }
  return null;
}

export function createMcpServer(
  cfg: AppConfig,
  db: DbClient,
  actionDb: ActionDbClient | null = null,
): Server {
  const server = new Server(
    { name: "wam-business-mcp", version: "0.1.22" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (cfg.killSwitch) {
      return { tools: [] };
    }
    const analyticsTools = listBusinessTools().map((t) => {
      const short = parseToolName(t.name) as ToolName;
      return {
        name: t.name,
        description: t.description,
        inputSchema: TOOL_SCHEMAS[short],
      };
    });
    const operationsTools = listOperationsTools().map((t) => {
      const short = parseOperationsToolName(t.name) as OperationsToolName;
      return {
        name: t.name,
        description: t.description,
        inputSchema: OPERATIONS_TOOL_SCHEMAS[short],
      };
    });
    const dispatchTools = listDispatchTools().map((t) => {
      const short = parseDispatchToolName(t.name) as DispatchToolName;
      return {
        name: t.name,
        description: t.description,
        inputSchema: DISPATCH_TOOL_SCHEMAS[short],
      };
    });
    const actionTools = listActionTools(cfg).map((t) => {
      const short = parseActionToolName(t.name) as ActionToolName;
      return {
        name: t.name,
        description: t.description,
        inputSchema: ACTION_TOOL_SCHEMAS[short],
      };
    });
    const notificationTools = listNotificationTools(cfg).map((t) => {
      const short = parseNotificationToolName(t.name) as NotificationToolName;
      return {
        name: t.name,
        description: t.description,
        inputSchema: NOTIFICATION_TOOL_SCHEMAS[short],
      };
    });
    const messagingTools = listSmsTools(cfg).map((t) => {
      const short = parseSmsToolName(t.name) as SmsToolName;
      return {
        name: t.name,
        description: t.description,
        inputSchema: SMS_TOOL_SCHEMAS[short],
      };
    });
    const intelligenceTools = listIntelligenceTools().map((t) => {
      const short = parseIntelligenceToolName(t.name) as IntelligenceToolName;
      return {
        name: t.name,
        description: t.description,
        inputSchema: INTELLIGENCE_TOOL_SCHEMAS[short],
      };
    });
    const documentTools = listDocumentTools().map((t) => {
      const short = parseDocumentToolName(t.name) as DocumentToolName;
      return {
        name: t.name,
        description: t.description,
        inputSchema: DOCUMENT_TOOL_SCHEMAS[short],
      };
    });
    const queryTools = listQueryTools().map((t) => {
      const short = parseQueryToolName(t.name) as QueryToolName;
      return {
        name: t.name,
        description: t.description,
        inputSchema: QUERY_TOOL_SCHEMAS[short],
      };
    });
    return {
      tools: [
        ...analyticsTools,
        ...operationsTools,
        ...dispatchTools,
        ...actionTools,
        ...notificationTools,
        ...messagingTools,
        ...intelligenceTools,
        ...documentTools,
        ...queryTools,
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const fullName = request.params.name;
    const parsed = parseAnyToolName(fullName);
    if (!parsed) {
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

    const actor = resolveActorFromConfig(cfg);
    const result =
      parsed.kind === "analytics"
        ? await executeBusinessTool({
            tool: parsed.tool,
            args,
            cfg,
            db,
            actor,
          })
        : parsed.kind === "dispatch"
          ? await executeDispatchTool({
              tool: parsed.tool,
              args,
              cfg,
              db,
              actor,
            })
          : parsed.kind === "action"
            ? await executeActionTool({
                tool: parsed.tool,
                args,
                cfg,
                db,
                actionDb,
                actor,
              })
            : parsed.kind === "notifications"
              ? await executeNotificationTool({
                  tool: parsed.tool,
                  args,
                  cfg,
                  db,
                  actionDb,
                  actor,
                })
              : parsed.kind === "messaging"
                ? await executeSmsTool({
                    tool: parsed.tool,
                    args,
                    cfg,
                    db,
                    actionDb,
                    actor,
                  })
                : parsed.kind === "intelligence"
                  ? await executeIntelligenceTool({
                      tool: parsed.tool,
                      args,
                      cfg,
                      db,
                      actor,
                    })
                  : parsed.kind === "documents"
                    ? await executeDocumentTool({
                        tool: parsed.tool,
                        args,
                        cfg,
                        db,
                        actor,
                      })
                    : parsed.kind === "query"
                      ? await executeQueryTool({
                          tool: parsed.tool,
                          args,
                          cfg,
                          db,
                          actor,
                        })
                      : await executeOperationsTool({
                          tool: parsed.tool,
                          args,
                          cfg,
                          actor,
                          db,
                        });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ...result,
            tool: `${parsed.namespace}.${parsed.tool}`,
          }),
        },
      ],
      isError: !result.ok,
    };
  });

  return server;
}

export async function startStdioServer(
  cfg: AppConfig,
  db: DbClient,
  actionDb: ActionDbClient | null = null,
): Promise<void> {
  const server = createMcpServer(cfg, db, actionDb);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
