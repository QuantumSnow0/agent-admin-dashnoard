import { randomUUID } from "crypto";
import {
  OPENBOOK_ALLOWED_ROLES,
  PRODUCTION_GATEWAY_ROLES,
  type ActorContext,
  type AppConfig,
  validateActionConfig,
} from "./config.js";
import type { DbClient } from "./db.js";
import type { ActionDbClient } from "./actionDb.js";
import { checkRateLimit, rateLimitKey } from "./rateLimit.js";
import { redactAuditParams } from "./privacy.js";
import {
  hashParams,
  redactParams,
  sanitizeErrorMessage,
  truncateJson,
} from "./redact.js";
import {
  NOTIFICATIONS_NAMESPACE,
  NOTIFICATION_ACTION_TO_SQL,
  NOTIFICATION_ACTION_TOOL_NAMES,
  NOTIFICATION_READ_TO_SQL,
  NOTIFICATION_READ_TOOL_NAMES,
  NOTIFICATION_TOOL_NAMES,
  fullNotificationToolName,
  isNotificationActionTool,
  parseNotificationArgs,
  parseNotificationToolName,
  type NotificationActionToolName,
  type NotificationReadToolName,
  type NotificationToolName,
} from "./validation-notifications.js";
import { ValidationError } from "./validation.js";

export type NotificationToolResult = {
  ok: boolean;
  denied?: boolean;
  auditId: string | null;
  correlationId?: string | null;
  data?: unknown;
  error?: { category: string; message: string };
};

const AUDIT_UNAVAILABLE_MSG = "Reporting temporarily unavailable";

function auditBase(
  correlationId: string,
  tool: NotificationToolName,
  actor: ActorContext,
  args: Record<string, unknown>,
) {
  return {
    correlationId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionOrChannelId: actor.sessionOrChannelId,
    operationName: fullNotificationToolName(tool),
    toolNamespace: NOTIFICATIONS_NAMESPACE,
    paramHash: hashParams(args),
    paramRedacted: redactNotificationAuditParams(redactParams(args)),
    instanceId: actor.instanceId,
    identityVerified: actor.identityVerified,
  };
}

function redactNotificationAuditParams(input: Record<string, unknown>): Record<string, unknown> {
  const base = redactAuditParams(input);
  if (typeof base.message === "string") {
    base.message = `[body:${base.message.length} chars]`;
  }
  if (typeof base.title === "string" && (base.title as string).length > 40) {
    base.title = `${(base.title as string).slice(0, 40)}…`;
  }
  return base;
}

function isReadAuthorized(cfg: AppConfig, actor: ActorContext): boolean {
  if (!OPENBOOK_ALLOWED_ROLES.includes(actor.actorRole)) return false;
  if (cfg.identityMode === "production" && !actor.identityVerified) return false;
  if (cfg.identityMode === "production" && !PRODUCTION_GATEWAY_ROLES.includes(actor.actorRole)) {
    return false;
  }
  return true;
}

function isActionAuthorized(cfg: AppConfig, actor: ActorContext): boolean {
  if (!cfg.actionsEnabled || !cfg.notificationActionsEnabled || !cfg.actionDatabaseUrl) {
    return false;
  }
  return isReadAuthorized(cfg, actor);
}

function mapPayloadError(payload: Record<string, unknown>): NotificationToolResult["error"] | null {
  const status = String(payload.status ?? "");
  if (status === "success") return null;
  const category = String(payload.error_category ?? status ?? "failure");
  const message = String(payload.message ?? category);
  return { category, message };
}

export async function executeNotificationTool(opts: {
  tool: NotificationToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actionDb: ActionDbClient | null;
  actor: ActorContext;
}): Promise<NotificationToolResult> {
  const { tool, cfg, db, actionDb, actor } = opts;
  const started = Date.now();
  const correlationId = randomUUID();
  const publicIds = { auditId: correlationId, correlationId };

  if (isNotificationActionTool(tool)) {
    return executeNotificationActionTool({
      tool,
      args: opts.args,
      cfg,
      db,
      actionDb,
      actor,
      started,
      correlationId,
      publicIds,
    });
  }

  return executeNotificationReadTool({
    tool: tool as NotificationReadToolName,
    args: opts.args,
    cfg,
    db,
    actor,
    started,
    correlationId,
    publicIds,
  });
}

async function executeNotificationReadTool(opts: {
  tool: NotificationReadToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actor: ActorContext;
  started: number;
  correlationId: string;
  publicIds: { auditId: string; correlationId: string };
}): Promise<NotificationToolResult> {
  const { tool, cfg, db, actor, started, correlationId, publicIds } = opts;

  const rl = checkRateLimit(
    rateLimitKey(actor.instanceId, actor.actorId),
    cfg.rateLimitPerMinute,
  );
  if (!rl.allowed) {
    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, opts.args),
      dataClassification: "denied",
      resultCount: 0,
      outcome: "denied",
      errorCategory: "rate_limited",
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: "rate_limited", message: "Too many requests; try again shortly" },
    };
  }

  if (!isReadAuthorized(cfg, actor)) {
    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, opts.args),
      dataClassification: "denied",
      resultCount: 0,
      outcome: "denied",
      errorCategory: "role_denied",
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: {
        category: "action_not_authorized",
        message: "Notification inspection is limited to verified technical_owner and business_partner",
      },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseNotificationArgs(tool, opts.args);
  } catch (err) {
    const code = err instanceof ValidationError ? err.code : "validation";
    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, opts.args),
      dataClassification: "denied",
      resultCount: 0,
      outcome: "denied",
      errorCategory: code,
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: "validation", message: "Invalid notification query parameters" },
    };
  }

  const mapping = NOTIFICATION_READ_TO_SQL[tool];
  try {
    const data = await db.callReportingFn("wam_ai", mapping.fn, mapping.argBuilder(parsed));
    const payload = (data ?? {}) as Record<string, unknown>;
    const err = mapPayloadError(payload);
    const { truncated } = truncateJson(data, cfg.maxResponseChars);
    if (truncated) {
      return {
        ok: false,
        ...publicIds,
        error: { category: "response_too_large", message: "Response exceeded size limit" },
      };
    }

    const resultCount =
      typeof payload.result_count === "number"
        ? payload.result_count
        : Array.isArray(payload.notifications)
          ? payload.notifications.length
          : err
            ? 0
            : 1;

    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, parsed),
      dataClassification: "personal_data",
      resultCount,
      outcome: err ? "failure" : "success",
      errorCategory: err?.category ?? null,
      durationMs: Date.now() - started,
    });

    if (err) return { ok: false, ...publicIds, data, error: err };
    return { ok: true, ...publicIds, data };
  } catch (err) {
    const s = sanitizeErrorMessage(err);
    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, parsed),
      dataClassification: "internal_operational",
      resultCount: 0,
      outcome: "failure",
      errorCategory: s.category,
      durationMs: Date.now() - started,
    });
    return { ok: false, ...publicIds, error: { category: s.category, message: s.message } };
  }
}

async function executeNotificationActionTool(opts: {
  tool: NotificationActionToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actionDb: ActionDbClient | null;
  actor: ActorContext;
  started: number;
  correlationId: string;
  publicIds: { auditId: string; correlationId: string };
}): Promise<NotificationToolResult> {
  const { tool, cfg, db, actionDb, actor, started, correlationId, publicIds } = opts;

  if (!cfg.actionsEnabled) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      auditId: null,
      error: { category: "action_disabled", message: "WAM AI business actions are disabled" },
    };
  }

  if (!cfg.notificationActionsEnabled) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: {
        category: "action_disabled",
        message: "Notification business actions are disabled for this MCP instance",
      },
    };
  }

  if (!actionDb || !cfg.actionDatabaseUrl) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      auditId: null,
      error: { category: "action_disabled", message: "Action database is not configured" },
    };
  }

  const rl = checkRateLimit(
    rateLimitKey(actor.instanceId, actor.actorId),
    cfg.rateLimitPerMinute,
  );
  if (!rl.allowed) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: "rate_limited", message: "Too many requests; try again shortly" },
    };
  }

  if (!isActionAuthorized(cfg, actor)) {
    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, opts.args),
      dataClassification: "denied",
      resultCount: 0,
      outcome: "denied",
      errorCategory: "role_denied",
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: {
        category: "action_not_authorized",
        message: "Notification actions are limited to verified technical_owner and business_partner",
      },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseNotificationArgs(tool, opts.args);
  } catch (err) {
    const code = err instanceof ValidationError ? err.code : "validation";
    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, opts.args),
      dataClassification: "denied",
      resultCount: 0,
      outcome: "denied",
      errorCategory: code,
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: "validation", message: "Invalid notification action parameters" },
    };
  }

  if (parsed.explicit_action_authorized !== true) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: {
        category: "validation",
        message: "explicit_action_authorized must be true for notification write actions",
      },
    };
  }

  const preAudit = await db.recordAudit({
    ...auditBase(correlationId, tool, actor, parsed),
    dataClassification: "internal_operational",
    resultCount: null,
    outcome: "failure",
    errorCategory: "pending_execution",
    durationMs: null,
  });
  if (!preAudit.ok) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      auditId: null,
      error: { category: "audit_unavailable", message: AUDIT_UNAVAILABLE_MSG },
    };
  }

  const mapping = NOTIFICATION_ACTION_TO_SQL[tool];
  const sqlArgs = mapping.argBuilder(parsed, {
    correlationId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
  });

  try {
    const data = await actionDb.callActionFn(mapping.fn, sqlArgs);
    const payload = (data ?? {}) as Record<string, unknown>;
    const err = mapPayloadError(payload);
    const { truncated } = truncateJson(data, cfg.maxResponseChars);
    if (truncated) {
      return {
        ok: false,
        ...publicIds,
        error: { category: "response_too_large", message: "Action response exceeded size limit" },
      };
    }

    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, {
        ...parsed,
        _result: {
          operation: payload.operation ?? tool,
          idempotent_replay: payload.idempotent_replay ?? false,
          notification_reference: payload.notification_reference ?? null,
          error_category: payload.error_category ?? null,
        },
      }),
      dataClassification: err ? "internal_operational" : "personal_data",
      resultCount: err ? 0 : 1,
      outcome: err ? "failure" : "success",
      errorCategory: err?.category ?? null,
      durationMs: Date.now() - started,
    });

    if (err) return { ok: false, ...publicIds, data, error: err };
    return { ok: true, ...publicIds, data };
  } catch (err) {
    const s = sanitizeErrorMessage(err);
    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, parsed),
      dataClassification: "internal_operational",
      resultCount: 0,
      outcome: "failure",
      errorCategory: s.category,
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      ...publicIds,
      error: { category: s.category, message: s.message },
    };
  }
}

export function listNotificationTools(cfg: AppConfig): Array<{ name: string; description: string }> {
  const readTools = NOTIFICATION_READ_TOOL_NAMES.map((tool) => ({
    name: fullNotificationToolName(tool),
    description: NOTIFICATION_READ_DESCRIPTIONS[tool],
  }));

  if (!validateActionConfig(cfg).ok || !cfg.notificationActionsEnabled) {
    return readTools;
  }

  const actionTools = NOTIFICATION_ACTION_TOOL_NAMES.map((tool) => ({
    name: fullNotificationToolName(tool),
    description: NOTIFICATION_ACTION_DESCRIPTIONS[tool],
  }));

  return [...readTools, ...actionTools];
}

const NOTIFICATION_ACTION_DESCRIPTIONS: Record<NotificationActionToolName, string> = {
  send_agent_notification:
    "Send one authorized custom in-app notification (SYSTEM_ANNOUNCEMENT) to exactly one verified agent. Creates a notification row only; push_attempted_by_rpc is always false and external push is not attempted. Optional deep_link supports verified in-app routes only (dashboard). Roles: technical_owner, business_partner.",
};

const NOTIFICATION_READ_DESCRIPTIONS: Record<NotificationReadToolName, string> = {
  get_agent_notification_history:
    "Read bounded notification history for one verified agent. Historical push_attempted is unknown without a provider receipt; current_device_token_available is a live snapshot. Roles: technical_owner, business_partner.",
  get_notification_delivery_status:
    "Look up delivery evidence by safe notification_reference (N- + 16 hex). Provider receipt means Expo ticket acceptance only; delivery_confirmed is always false. Roles: technical_owner, business_partner.",
};

export {
  parseNotificationToolName,
  fullNotificationToolName,
  NOTIFICATION_TOOL_NAMES,
  NOTIFICATIONS_NAMESPACE,
};
