import { randomUUID } from "crypto";
import { OPENBOOK_ALLOWED_ROLES, type ActorContext, type AppConfig } from "./config.js";
import type { DbClient } from "./db.js";
import { checkRateLimit, rateLimitKey } from "./rateLimit.js";
import { assertDispatchOutputAllowed, containsHighlySensitive, redactAuditParams } from "./privacy.js";
import {
  hashParams,
  redactParams,
  sanitizeErrorMessage,
  truncateJson,
} from "./redact.js";
import {
  DISPATCH_TOOL_NAMES,
  DISPATCH_TOOL_TO_SQL,
  parseDispatchArgs,
  type DispatchToolName,
} from "./validation-dispatch.js";
import { ValidationError } from "./validation.js";

export const DISPATCH_TOOL_NAMESPACE = "wam.business.dispatch";

export type DispatchToolResult = {
  ok: boolean;
  denied?: boolean;
  auditId: string | null;
  correlationId?: string | null;
  data?: unknown;
  error?: { category: string; message: string };
};

const AUDIT_UNAVAILABLE_MSG = "Reporting temporarily unavailable";

function isDispatchAuthorized(actor: ActorContext): boolean {
  return OPENBOOK_ALLOWED_ROLES.includes(actor.actorRole);
}

function auditBase(
  correlationId: string,
  tool: DispatchToolName,
  actor: ActorContext,
  args: Record<string, unknown>,
) {
  return {
    correlationId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionOrChannelId: actor.sessionOrChannelId,
    operationName: tool,
    toolNamespace: DISPATCH_TOOL_NAMESPACE,
    paramHash: hashParams(args),
    paramRedacted: redactAuditParams(redactParams(args)),
    instanceId: actor.instanceId,
    identityVerified: actor.identityVerified,
  };
}

function auditResultSummary(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const o = data as Record<string, unknown>;
  return {
    radius_expansion_used: o.radius_expansion_used ?? null,
    no_recommendation: o.recommended_agent == null,
    result_count: o.result_count ?? null,
    recommendation_confidence: o.recommendation_confidence ?? null,
  };
}

function resultCountOf(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.result_count === "number") return o.result_count;
  if (Array.isArray(o.candidates)) return o.candidates.length;
  return o.status === "success" ? 1 : 0;
}

function classifyOutput(data: unknown): "personal_data" | "highly_sensitive" {
  return containsHighlySensitive(data) ? "highly_sensitive" : "personal_data";
}

export async function executeDispatchTool(opts: {
  tool: DispatchToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actor: ActorContext;
}): Promise<DispatchToolResult> {
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
        message: "WAM AI dispatch recommendations temporarily unavailable",
      },
    };
  }

  if (!DISPATCH_TOOL_NAMES.includes(tool)) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      auditId: null,
      error: { category: "denied", message: "Unknown tool" },
    };
  }

  if (!isDispatchAuthorized(actor)) {
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
        message: "Dispatch recommendations are limited to technical_owner and business_partner",
      },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseDispatchArgs(tool, opts.args);
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

  const mapping = DISPATCH_TOOL_TO_SQL[tool];
  const sqlArgs = mapping.argBuilder(parsed);

  try {
    const data = await db.callReportingFn(mapping.schema, mapping.fn, sqlArgs);
    const privacyHits = assertDispatchOutputAllowed(tool, data);
    if (privacyHits.length) {
      const audit = await db.recordAudit({
        ...auditBase(correlationId, tool, actor, {
          ...parsed,
          _result: auditResultSummary(data),
        }),
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
    if (payload.status === "ambiguous") {
      const completion = await db.recordAudit({
        ...auditBase(correlationId, tool, actor, {
          ...parsed,
          _result: auditResultSummary(data),
        }),
        dataClassification: "personal_data",
        resultCount: typeof payload.match_count === "number" ? payload.match_count : 0,
        outcome: "failure",
        errorCategory: "ambiguous_match",
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
        ok: false,
        ...publicIds,
        data,
        error: {
          category: "ambiguous_match",
          message: String(payload.message ?? "Conflicting lead identifiers"),
        },
      };
    }

    if (payload.status === "not_found") {
      const completion = await db.recordAudit({
        ...auditBase(correlationId, tool, actor, {
          ...parsed,
          _result: auditResultSummary(data),
        }),
        dataClassification: "internal_operational",
        resultCount: 0,
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
          message: "Response exceeded size limit; lower limit parameter",
        },
      };
    }

    const dataClass = classifyOutput(data);
    const completion = await db.recordAudit({
      ...auditBase(correlationId, tool, actor, {
        ...parsed,
        _result: auditResultSummary(data),
      }),
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

export function listDispatchTools(): Array<{ name: string; description: string }> {
  return DISPATCH_TOOL_NAMES.map((short) => ({
    name: `${DISPATCH_TOOL_NAMESPACE}.${short}`,
    description:
      short === "recommend_agents_for_lead"
        ? "Read-only verified agent recommendations for an unassigned inbound lead (no assignment or offers)"
        : `WAM dispatch recommendation: ${short}`,
  }));
}

export function parseDispatchToolName(full: string): DispatchToolName | null {
  const prefix = `${DISPATCH_TOOL_NAMESPACE}.`;
  if (!full.startsWith(prefix)) return null;
  const short = full.slice(prefix.length) as DispatchToolName;
  return DISPATCH_TOOL_NAMES.includes(short) ? short : null;
}
