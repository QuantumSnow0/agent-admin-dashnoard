import { randomUUID } from "crypto";
import { OPENBOOK_ALLOWED_ROLES, type ActorContext, type AppConfig } from "./config.js";
import type { DbClient } from "./db.js";
import { checkRateLimit, rateLimitKey } from "./rateLimit.js";
import {
  assertOpenBookOutputAllowed,
  containsHighlySensitive,
  type OperationsToolName,
} from "./privacy.js";
import {
  hashParams,
  redactParams,
  sanitizeErrorMessage,
  truncateJson,
} from "./redact.js";
import {
  OPERATIONS_TOOL_NAMES,
  OPERATIONS_TOOL_TO_SQL,
  parseOperationsArgs,
} from "./validation-operations.js";
import { ValidationError } from "./validation.js";

export const OPERATIONS_TOOL_NAMESPACE = "wam.business.operations";

export type OperationsToolResult = {
  ok: boolean;
  denied?: boolean;
  auditId: string | null;
  correlationId?: string | null;
  data?: unknown;
  error?: { category: string; message: string };
};

const AUDIT_UNAVAILABLE_MSG = "Reporting temporarily unavailable";

function isOpenBookAuthorized(actor: ActorContext): boolean {
  return OPENBOOK_ALLOWED_ROLES.includes(actor.actorRole);
}

function auditBase(
  correlationId: string,
  tool: OperationsToolName,
  actor: ActorContext,
  args: Record<string, unknown>,
) {
  return {
    correlationId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionOrChannelId: actor.sessionOrChannelId,
    operationName: tool,
    toolNamespace: OPERATIONS_TOOL_NAMESPACE,
    paramHash: hashParams(args),
    paramRedacted: redactParams(args),
    instanceId: actor.instanceId,
    identityVerified: actor.identityVerified,
  };
}

function resultCountOf(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.result_count === "number") return o.result_count;
  if (typeof o.match_count === "number") return o.match_count;
  if (Array.isArray(o.agents)) return o.agents.length;
  if (Array.isArray(o.leads)) return o.leads.length;
  if (Array.isArray(o.customers)) return o.customers.length;
  if (o.status === "success") return 1;
  return 0;
}

function classifyOutput(data: unknown): "personal_data" | "highly_sensitive" {
  return containsHighlySensitive(data) ? "highly_sensitive" : "personal_data";
}

export async function executeOperationsTool(opts: {
  tool: OperationsToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actor: ActorContext;
}): Promise<OperationsToolResult> {
  const { tool, cfg, db, actor } = opts;
  const started = Date.now();
  const correlationId = randomUUID();
  const publicIds = { auditId: correlationId, correlationId };

  const rl = checkRateLimit(
    rateLimitKey(actor.instanceId, actor.actorId),
    cfg.rateLimitPerMinute,
  );
  if (!rl.allowed) {
    const audit = await db.recordAudit({
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
      auditId: audit.ok ? correlationId : null,
      error: { category: "rate_limited", message: "Too many requests; try again shortly" },
    };
  }

  if (cfg.killSwitch) {
    const audit = await db.recordAudit({
      ...auditBase(correlationId, tool, actor, opts.args),
      dataClassification: "denied",
      resultCount: 0,
      outcome: "denied",
      errorCategory: "kill_switch",
      durationMs: Date.now() - started,
    });
    return {
      ok: false,
      denied: true,
      ...publicIds,
      auditId: audit.ok ? correlationId : null,
      error: {
        category: "kill_switch",
        message: "WAM AI reporting temporarily unavailable",
      },
    };
  }

  if (!OPERATIONS_TOOL_NAMES.includes(tool)) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      auditId: null,
      error: { category: "denied", message: "Unknown tool" },
    };
  }

  if (!isOpenBookAuthorized(actor)) {
    const audit = await db.recordAudit({
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
      auditId: audit.ok ? correlationId : null,
      error: {
        category: "denied",
        message: "Open-book reporting is limited to technical_owner and business_partner",
      },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseOperationsArgs(tool, opts.args);
  } catch (err) {
    const code = err instanceof ValidationError ? err.code : "validation";
    const audit = await db.recordAudit({
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
      auditId: audit.ok ? correlationId : null,
      error: { category: "validation", message: "Invalid parameters" },
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

  const mapping = OPERATIONS_TOOL_TO_SQL[tool];
  const sqlArgs = mapping.argBuilder(parsed);

  try {
    const data = await db.callReportingFn(mapping.schema, mapping.fn, sqlArgs);
    const privacyHits = assertOpenBookOutputAllowed(tool, data);
    if (privacyHits.length) {
      const audit = await db.recordAudit({
        ...auditBase(correlationId, tool, actor, parsed),
        dataClassification: "denied",
        resultCount: 0,
        outcome: "failure",
        errorCategory: "pii_guard",
        durationMs: Date.now() - started,
      });
      return {
        ok: false,
        ...publicIds,
        auditId: audit.ok ? correlationId : correlationId,
        error: { category: "pii_guard", message: "Result blocked by privacy guard" },
      };
    }

    const payload = data as Record<string, unknown>;
    if (
      tool.startsWith("get_") &&
      payload.status &&
      payload.status !== "success"
    ) {
      const completion = await db.recordAudit({
        ...auditBase(correlationId, tool, actor, parsed),
        dataClassification: "personal_data",
        resultCount: typeof payload.match_count === "number" ? payload.match_count : 0,
        outcome: payload.status === "ambiguous" ? "failure" : "success",
        errorCategory: payload.status === "ambiguous" ? "ambiguous_match" : null,
        durationMs: Date.now() - started,
      });
      if (!completion.ok) {
        return {
          ok: false,
          denied: true,
          ...publicIds,
          auditId: correlationId,
          error: { category: "audit_unavailable", message: AUDIT_UNAVAILABLE_MSG },
        };
      }
      return {
        ok: payload.status !== "ambiguous",
        ...publicIds,
        data,
        error:
          payload.status === "ambiguous"
            ? {
                category: "ambiguous_match",
                message: String(payload.message ?? "Multiple records matched"),
              }
            : undefined,
      };
    }

    const { truncated } = truncateJson(data, cfg.maxResponseChars);
    if (truncated) {
      const audit = await db.recordAudit({
        ...auditBase(correlationId, tool, actor, parsed),
        dataClassification: "denied",
        resultCount: 0,
        outcome: "failure",
        errorCategory: "response_too_large",
        durationMs: Date.now() - started,
      });
      return {
        ok: false,
        ...publicIds,
        auditId: audit.ok ? correlationId : correlationId,
        error: {
          category: "response_too_large",
          message: "Response exceeded size limit; narrow filters or lower limit",
        },
      };
    }

    const dataClass = classifyOutput(data);
    const completion = await db.recordAudit({
      ...auditBase(correlationId, tool, actor, parsed),
      dataClassification: dataClass,
      resultCount: resultCountOf(data),
      outcome: "success",
      errorCategory: null,
      durationMs: Date.now() - started,
    });
    if (!completion.ok) {
      return {
        ok: false,
        denied: true,
        ...publicIds,
        auditId: correlationId,
        error: { category: "audit_unavailable", message: AUDIT_UNAVAILABLE_MSG },
      };
    }
    return { ok: true, ...publicIds, data };
  } catch (err) {
    const s = sanitizeErrorMessage(err);
    const audit = await db.recordAudit({
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
      auditId: audit.ok ? correlationId : correlationId,
      error: { category: s.category, message: s.message },
    };
  }
}

export function listOperationsTools(): Array<{ name: string; description: string }> {
  return OPERATIONS_TOOL_NAMES.map((short) => ({
    name: `${OPERATIONS_TOOL_NAMESPACE}.${short}`,
    description: `Authorized open-book WAM business record lookup: ${short}`,
  }));
}

export function parseOperationsToolName(full: string): OperationsToolName | null {
  const prefix = `${OPERATIONS_TOOL_NAMESPACE}.`;
  if (!full.startsWith(prefix)) return null;
  const short = full.slice(prefix.length) as OperationsToolName;
  return OPERATIONS_TOOL_NAMES.includes(short) ? short : null;
}
