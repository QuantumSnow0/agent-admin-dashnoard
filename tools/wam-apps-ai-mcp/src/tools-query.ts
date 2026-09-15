/**
 * Phase 1A.9 — wam.business.query tool execution.
 * Read-only; open-book for technical_owner / business_partner.
 */

import { randomUUID } from "node:crypto";
import type { AppConfig, ActorContext } from "./config.js";
import { OPENBOOK_ALLOWED_ROLES } from "./config.js";
import type { DbClient } from "./db.js";
import { checkRateLimit, rateLimitKey } from "./rateLimit.js";
import { hashParams, sanitizeErrorMessage, truncateJson } from "./redact.js";
import { ValidationError } from "./validation.js";
import { buildCataloguePayload } from "./query-catalogue.js";
import {
  QUERY_NAMESPACE,
  QUERY_TOOL_NAMES,
  QUERY_TOOL_TO_SQL,
  fullQueryToolName,
  parseQueryArgs,
  parseQueryToolName,
  redactQueryAuditArgs,
  tryClarification,
  type QueryToolName,
} from "./validation-query.js";

const PRODUCTION_GATEWAY_ROLES = ["technical_owner", "business_partner"] as const;

export type QueryToolResult = {
  ok: boolean;
  denied?: boolean;
  auditId: string | null;
  correlationId: string;
  data?: unknown;
  error?: { category: string; message: string };
};

function isReadAuthorized(cfg: AppConfig, actor: ActorContext): boolean {
  if (!OPENBOOK_ALLOWED_ROLES.includes(actor.actorRole as (typeof OPENBOOK_ALLOWED_ROLES)[number])) {
    return false;
  }
  if (cfg.identityMode === "production" && !actor.identityVerified) return false;
  if (
    cfg.identityMode === "production" &&
    !PRODUCTION_GATEWAY_ROLES.includes(actor.actorRole as (typeof PRODUCTION_GATEWAY_ROLES)[number])
  ) {
    return false;
  }
  return true;
}

function auditBase(
  correlationId: string,
  tool: QueryToolName,
  actor: ActorContext,
  args: Record<string, unknown>,
) {
  return {
    correlationId,
    operationName: fullQueryToolName(tool),
    toolNamespace: QUERY_NAMESPACE,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionOrChannelId: actor.sessionOrChannelId,
    paramHash: hashParams(redactQueryAuditArgs(tool, args)),
    paramRedacted: redactQueryAuditArgs(tool, args),
    instanceId: actor.instanceId,
    identityVerified: actor.identityVerified,
  };
}

async function persistAudit(
  db: DbClient,
  row: Parameters<DbClient["recordAudit"]>[0],
): Promise<string | null> {
  const w = await db.recordAudit(row);
  return w.ok ? w.id : null;
}

function mapPayloadError(payload: Record<string, unknown>): QueryToolResult["error"] | null {
  const status = String(payload.status ?? "");
  if (status === "success") return null;
  if (status === "clarification_required") return null;
  return {
    category: String(payload.error_category ?? status ?? "failure"),
    message: String(payload.message ?? status),
  };
}

/** Open-book: phones and names allowed; internal UUIDs / record_id keys forbidden. */
export function assertQueryOutputSafe(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...assertQueryOutputSafe(v, `${path}[${i}]`)));
    return hits;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && UUID_RE.test(value) && path.endsWith(".id")) {
      hits.push(path);
    }
    return hits;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/^(id|record_id|agent_id|lead_id|registration_id)$/i.test(k)) {
      hits.push(`${path}.${k}`);
    }
    if (typeof v === "string" && UUID_RE.test(v) && /(_id|uuid)$/i.test(k) && k !== "correlation_id") {
      hits.push(`${path}.${k}`);
    }
    hits.push(...assertQueryOutputSafe(v, `${path}.${k}`));
  }
  return hits;
}

export async function executeQueryTool(opts: {
  tool: QueryToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actor: ActorContext;
}): Promise<QueryToolResult> {
  const { tool, cfg, db, actor } = opts;
  const started = Date.now();
  const correlationId = randomUUID();
  let auditId: string | null = null;

  const rl = checkRateLimit(
    rateLimitKey(actor.instanceId, actor.actorId),
    cfg.rateLimitPerMinute,
  );
  if (!rl.allowed) {
    return {
      ok: false,
      denied: true,
      auditId: null,
      correlationId,
      error: { category: "rate_limited", message: "Too many requests; try again shortly" },
    };
  }

  if (!isReadAuthorized(cfg, actor)) {
    return {
      ok: false,
      denied: true,
      auditId: null,
      correlationId,
      error: {
        category: "action_not_authorized",
        message: "Query tools are limited to verified technical_owner and business_partner",
      },
    };
  }

  const clarification = tryClarification(tool, opts.args);
  if (clarification) {
    auditId = await persistAudit(db, {
      ...auditBase(correlationId, tool, actor, opts.args),
      dataClassification: "internal_operational",
      resultCount: 0,
      outcome: "success",
      errorCategory: null,
      durationMs: Date.now() - started,
    });
    return { ok: true, auditId, correlationId, data: clarification };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseQueryArgs(tool, opts.args);
  } catch {
    return {
      ok: false,
      denied: true,
      auditId: null,
      correlationId,
      error: { category: "validation", message: "Invalid query parameters" },
    };
  }

  // Catalogue is served from the versioned TypeScript mirror (SQL has a parity RPC for DB verify).
  if (tool === "describe_business_query_catalogue") {
    const payload = {
      status: "success",
      ...buildCataloguePayload(
        typeof parsed.dataset === "string" ? parsed.dataset : null,
      ),
    };
    auditId = await persistAudit(db, {
      ...auditBase(correlationId, tool, actor, parsed),
      dataClassification: "internal_operational",
      resultCount: 1,
      outcome: "success",
      errorCategory: null,
      durationMs: Date.now() - started,
    });
    return { ok: true, auditId, correlationId, data: payload };
  }

  if (!parsed.dataset) {
    return {
      ok: false,
      denied: true,
      auditId: null,
      correlationId,
      error: { category: "validation", message: "dataset is required" },
    };
  }

  const mapping = QUERY_TOOL_TO_SQL[tool];
  if (!mapping.fn) {
    return {
      ok: false,
      auditId: null,
      correlationId,
      error: { category: "failure", message: "Query tool mapping missing" },
    };
  }

  try {
    const data = await db.callReportingFn("wam_ai", mapping.fn, mapping.argBuilder(parsed));
    const payload = (data ?? {}) as Record<string, unknown>;
    const err = mapPayloadError(payload);
    if (!err) {
      const unsafe = assertQueryOutputSafe(payload);
      if (unsafe.length > 0) {
        auditId = await persistAudit(db, {
          ...auditBase(correlationId, tool, actor, parsed),
          dataClassification: "internal_operational",
          resultCount: 0,
          outcome: "failure",
          errorCategory: "output_policy",
          durationMs: Date.now() - started,
        });
        return {
          ok: false,
          auditId,
          correlationId,
          error: { category: "output_policy", message: "Response failed privacy checks" },
        };
      }
    }

    const count =
      typeof payload.returned_row_count === "number"
        ? payload.returned_row_count
        : typeof payload.result_count === "number"
          ? payload.result_count
          : err
            ? 0
            : 1;

    auditId = await persistAudit(db, {
      ...auditBase(correlationId, tool, actor, parsed),
      dataClassification: "personal_data",
      resultCount: err ? 0 : count,
      outcome: err ? "failure" : "success",
      errorCategory: err?.category ?? null,
      durationMs: Date.now() - started,
    });

    if (err) return { ok: false, auditId, correlationId, data, error: err };

    const { truncated } = truncateJson(payload, cfg.maxResponseChars);
    if (truncated) {
      return {
        ok: false,
        auditId,
        correlationId,
        error: {
          category: "response_too_large",
          message: "Response exceeded size limit; reduce limit or select fewer fields",
        },
      };
    }
    return { ok: true, auditId, correlationId, data: payload };
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        ok: false,
        denied: true,
        auditId: null,
        correlationId,
        error: { category: "validation", message: "Invalid query parameters" },
      };
    }
    const s = sanitizeErrorMessage(err);
    try {
      auditId = await persistAudit(db, {
        ...auditBase(correlationId, tool, actor, parsed),
        dataClassification: "internal_operational",
        resultCount: 0,
        outcome: "failure",
        errorCategory: s.category,
        durationMs: Date.now() - started,
      });
    } catch {
      auditId = null;
    }
    return { ok: false, auditId, correlationId, error: { category: s.category, message: s.message } };
  }
}

const DESCRIPTIONS: Record<QueryToolName, string> = {
  describe_business_query_catalogue:
    "Return the allowlisted business query catalogue (datasets, fields, operators, aggregates, limits, semantic aliases). Use before structured queries when unsure. Pass intent=customers_visit_today or installations_by_county_period to get clarification metadata for OpenClaw ask_user — never guess the dataset.",
  list_business_records:
    "List allowlisted business records with structured filters (no SQL). visit_day maps to visit_date; never substitutes created_at. Paginated with total_count vs returned_row_count. Open-book phones for owner. response_mode: number_only|summary|detailed.",
  aggregate_business_metrics:
    "Aggregate allowlisted metrics (count/count_distinct/min/max) with filters and optional group_by. agents joined → created_at. Relative dates use Africa/Nairobi half-open ranges. response_mode number_only returns scalar counts only.",
};

export function listQueryTools(): Array<{ name: string; description: string }> {
  return QUERY_TOOL_NAMES.map((tool) => ({
    name: fullQueryToolName(tool),
    description: DESCRIPTIONS[tool],
  }));
}

export {
  parseQueryToolName,
  fullQueryToolName,
  QUERY_TOOL_NAMES,
  QUERY_NAMESPACE,
};
