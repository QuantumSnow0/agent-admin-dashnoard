import { randomUUID } from "crypto";
import type { ActorContext, AppConfig } from "./config.js";
import type { DbClient } from "./db.js";
import { checkRateLimit, rateLimitKey } from "./rateLimit.js";
import {
  assertNoPiiKeys,
  hashParams,
  redactParams,
  sanitizeErrorMessage,
  truncateJson,
} from "./redact.js";
import {
  BUSINESS_TOOL_NAMES,
  TOOL_INPUTS,
  TOOL_TO_SQL,
  ValidationError,
  type ToolName,
  validateLimit,
  validateRange,
} from "./validation.js";

export const TOOL_NAMESPACE = "wam.business.analytics";

export type ToolResult = {
  ok: boolean;
  denied?: boolean;
  /** Public audit reference = server-generated correlation ID. */
  auditId: string | null;
  correlationId?: string | null;
  data?: unknown;
  error?: { category: string; message: string };
};

function resultCountOf(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.result_count === "number") return o.result_count;
  if (typeof o.total_stalled_count === "number") return o.total_stalled_count;
  if (Array.isArray(o.leads)) return o.leads.length;
  if (Array.isArray(o.agents)) return o.agents.length;
  if (Array.isArray(o.counties)) return o.counties.length;
  if (Array.isArray(o.exceptions)) return o.exceptions.length;
  if (Array.isArray(o.series)) return o.series.length;
  return 1;
}

const AUDIT_UNAVAILABLE_MSG = "Analytics temporarily unavailable";

function auditBase(
  correlationId: string,
  tool: ToolName,
  actor: ActorContext,
  args: Record<string, unknown>,
) {
  return {
    correlationId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionOrChannelId: actor.sessionOrChannelId,
    operationName: tool,
    toolNamespace: TOOL_NAMESPACE,
    paramHash: hashParams(args),
    paramRedacted: redactParams(args),
    instanceId: actor.instanceId,
    identityVerified: actor.identityVerified,
  };
}

/**
 * Fail-closed for live data paths.
 * Correlation ID is generated once per tool call (never from args).
 * Rate limit runs before any reporting DB call.
 */
export async function executeBusinessTool(opts: {
  tool: ToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actor: ActorContext;
}): Promise<ToolResult> {
  const { tool, cfg, db, actor } = opts;
  const started = Date.now();
  // Generate ONCE — never accept from model args / conversation.
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
      error: {
        category: "rate_limited",
        message: "Too many requests; try again shortly",
      },
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
      error: { category: "kill_switch", message: "WAM AI analytics temporarily unavailable" },
    };
  }

  if (!BUSINESS_TOOL_NAMES.includes(tool)) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      auditId: null,
      error: { category: "denied", message: "Unknown tool" },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = TOOL_INPUTS[tool].parse(opts.args) as Record<string, unknown>;
    if ("from" in parsed || "to" in parsed) {
      validateRange(parsed.from as string | undefined, parsed.to as string | undefined);
    }
    if ("limit" in parsed) {
      validateLimit(parsed.limit as number | undefined);
    }
  } catch (err) {
    const code =
      err instanceof ValidationError
        ? err.code
        : err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ZodError"
          ? "unsupported_filter"
          : "validation";
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

  // Pre-call audit — fail closed if audit cannot be written.
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

  const mapping = TOOL_TO_SQL[tool];
  const sqlArgs = mapping.argBuilder(parsed).map((v) => {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      return new Date(v).toISOString();
    }
    return v;
  });

  try {
    const data = await db.callReportingFn(mapping.schema, mapping.fn, sqlArgs);
    const piiHits = assertNoPiiKeys(data);
    if (piiHits.length) {
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
          message: "Response exceeded size limit; request a narrower range or lower limit",
        },
      };
    }

    const completion = await db.recordAudit({
      ...auditBase(correlationId, tool, actor, parsed),
      dataClassification: "safe_aggregate",
      resultCount: resultCountOf(data),
      outcome: "success",
      errorCategory: null,
      durationMs: Date.now() - started,
    });
    // Completion audit required — do not return live production results without it.
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

export function listBusinessTools(): Array<{
  name: string;
  description: string;
}> {
  return BUSINESS_TOOL_NAMES.map((short) => ({
    name: `${TOOL_NAMESPACE}.${short}`,
    description: `Read-only WAM business analytics: ${short}`,
  }));
}

export function parseToolName(full: string): ToolName | null {
  const prefix = `${TOOL_NAMESPACE}.`;
  if (!full.startsWith(prefix)) return null;
  const short = full.slice(prefix.length) as ToolName;
  return BUSINESS_TOOL_NAMES.includes(short) ? short : null;
}
