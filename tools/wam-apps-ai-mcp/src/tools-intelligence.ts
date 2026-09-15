import { randomUUID } from "node:crypto";
import type { AppConfig, ActorContext } from "./config.js";
import { OPENBOOK_ALLOWED_ROLES } from "./config.js";
import type { DbClient } from "./db.js";
import { checkRateLimit, rateLimitKey } from "./rateLimit.js";
import { hashParams, sanitizeErrorMessage, truncateJson } from "./redact.js";
import { ValidationError } from "./validation.js";
import {
  INTELLIGENCE_NAMESPACE,
  INTELLIGENCE_TOOL_NAMES,
  INTELLIGENCE_TOOL_TO_SQL,
  fullIntelligenceToolName,
  parseIntelligenceArgs,
  parseIntelligenceToolName,
  redactIntelligenceAuditArgs,
  type IntelligenceToolName,
} from "./validation-intelligence.js";

const PRODUCTION_GATEWAY_ROLES = ["technical_owner", "business_partner"] as const;

export type IntelligenceToolResult = {
  ok: boolean;
  denied?: boolean;
  /** Present only after a successful audit persistence. Never equals an unpersisted correlationId claim. */
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
  tool: IntelligenceToolName,
  actor: ActorContext,
  args: Record<string, unknown>,
) {
  return {
    correlationId,
    operationName: fullIntelligenceToolName(tool),
    toolNamespace: INTELLIGENCE_NAMESPACE,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionOrChannelId: actor.sessionOrChannelId,
    paramHash: hashParams(redactIntelligenceAuditArgs(tool, args)),
    paramRedacted: redactIntelligenceAuditArgs(tool, args),
    instanceId: actor.instanceId,
    identityVerified: actor.identityVerified,
  };
}

function mapPayloadError(payload: Record<string, unknown>): IntelligenceToolResult["error"] | null {
  const status = String(payload.status ?? "");
  if (status === "success") return null;
  return {
    category: String(payload.error_category ?? status ?? "failure"),
    message: String(payload.message ?? status),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reject raw phones, record_id keys, and internal UUIDs in intelligence outputs. */
export function assertIntelligenceOutputSafe(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...assertIntelligenceOutputSafe(v, `${path}[${i}]`)));
    return hits;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (/^254[17]\d{8}$/.test(value)) hits.push(path);
      if (UUID_RE.test(value)) hits.push(path);
    }
    return hits;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (
      /^(airtel_phone|safaricom_phone|primary_phone|alternate_phone|phone|record_id)$/i.test(k)
    ) {
      hits.push(`${path}.${k}`);
    }
    hits.push(...assertIntelligenceOutputSafe(v, `${path}.${k}`));
  }
  return hits;
}

async function persistAudit(
  db: DbClient,
  row: Parameters<DbClient["recordAudit"]>[0],
): Promise<string | null> {
  const w = await db.recordAudit(row);
  return w.ok ? w.id : null;
}

export async function executeIntelligenceTool(opts: {
  tool: IntelligenceToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actor: ActorContext;
}): Promise<IntelligenceToolResult> {
  const { tool, cfg, db, actor } = opts;
  const started = Date.now();
  const correlationId = randomUUID();
  // auditId stays null until recordAudit succeeds — never treat correlationId as an audit ref
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
        message: "Intelligence tools are limited to verified technical_owner and business_partner",
      },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseIntelligenceArgs(tool, opts.args);
  } catch {
    return {
      ok: false,
      denied: true,
      auditId: null,
      correlationId,
      error: { category: "validation", message: "Invalid intelligence parameters" },
    };
  }

  const mapping = INTELLIGENCE_TOOL_TO_SQL[tool];
  try {
    const data = await db.callReportingFn("wam_ai", mapping.fn, mapping.argBuilder(parsed));
    const payload = (data ?? {}) as Record<string, unknown>;
    const err = mapPayloadError(payload);
    if (!err) {
      const unsafe = assertIntelligenceOutputSafe(payload);
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
      typeof payload.result_count === "number"
        ? payload.result_count
        : typeof payload.input_row_count === "number"
          ? payload.input_row_count
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
          message: "Response exceeded size limit; reduce row count",
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
        error: { category: "validation", message: "Invalid intelligence parameters" },
      };
    }
    const s = sanitizeErrorMessage(err);
    // Truthful failure auditing: attempt redacted failure audit in outer catch
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

const DESCRIPTIONS: Record<IntelligenceToolName, string> = {
  reconcile_customer_batch:
    "Batch-reconcile up to 250 spreadsheet rows against Agent Hub. Groups rows by normalized-phone overlap; hub identities link lead↔registration via inbound_lead_id. Returns unique-customer totals (not duplicate-inflated row totals), install/source buckets, masked phones. Never confirms by fuzzy name; never returns record_id UUIDs.",
  get_agent_lifecycle:
    "Read-only agent lifecycle visibility: account created_at when present, current status, status-transition evidence, and earliest operational activity — never invents join/approval dates.",
  get_notification_capability_catalogue:
    "Read-only catalogue of known Agent Hub notification types, producers, channels, and whether WAM AI may create them. Does not send notifications or enable broadcast.",
};

export function listIntelligenceTools(): Array<{ name: string; description: string }> {
  return INTELLIGENCE_TOOL_NAMES.map((tool) => ({
    name: fullIntelligenceToolName(tool),
    description: DESCRIPTIONS[tool],
  }));
}

export {
  parseIntelligenceToolName,
  fullIntelligenceToolName,
  INTELLIGENCE_TOOL_NAMES,
  INTELLIGENCE_NAMESPACE,
};
