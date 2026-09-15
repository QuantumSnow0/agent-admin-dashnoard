import { randomUUID } from "node:crypto";
import type { AppConfig, ActorContext } from "./config.js";
import type { DbClient } from "./db.js";
import type { ActionDbClient } from "./actionDb.js";
import { validateActionConfig } from "./config.js";
import { checkRateLimit, rateLimitKey } from "./rateLimit.js";
import { hashParams, redactParams, sanitizeErrorMessage, truncateJson } from "./redact.js";
import { redactAuditParams } from "./privacy.js";
import { ValidationError } from "./validation.js";
import {
  createOnfonSmsProvider,
  loadSmsProviderConfig,
  type SmsProvider,
} from "./smsProvider.js";
import {
  fullSmsToolName,
  isSmsActionTool,
  parseSmsArgs,
  parseSmsToolName,
  SMS_ACTION_TOOL_NAMES,
  SMS_READ_TOOL_NAMES,
  SMS_READ_TO_SQL,
  SMS_TOOL_NAMES,
  MESSAGING_NAMESPACE,
  type SmsActionToolName,
  type SmsReadToolName,
  type SmsToolName,
  estimateSmsSegments,
} from "./validation-sms.js";

const OPENBOOK_ALLOWED_ROLES = ["technical_owner", "business_partner"] as const;
const PRODUCTION_GATEWAY_ROLES = ["technical_owner", "business_partner"] as const;
const AUDIT_UNAVAILABLE_MSG = "Audit trail unavailable; refusing action";

export type SmsToolResult = {
  ok: boolean;
  denied?: boolean;
  auditId: string | null;
  correlationId: string;
  data?: unknown;
  error?: { category: string; message: string };
};

let injectedSmsProvider: SmsProvider | null = null;

/** Test-only: inject mock SMS provider (never used in production packaging). */
export function setSmsProviderForTests(provider: SmsProvider | null): void {
  injectedSmsProvider = provider;
}

function auditBase(
  correlationId: string,
  tool: SmsToolName,
  actor: ActorContext,
  args: Record<string, unknown>,
) {
  return {
    correlationId,
    operationName: fullSmsToolName(tool),
    toolNamespace: MESSAGING_NAMESPACE,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionOrChannelId: actor.sessionOrChannelId,
    paramHash: hashParams(args),
    paramRedacted: redactSmsAuditParams(redactParams(args)),
    instanceId: actor.instanceId,
    identityVerified: actor.identityVerified,
  };
}

function redactSmsAuditParams(input: Record<string, unknown>): Record<string, unknown> {
  const base = redactAuditParams(input);
  if (typeof base.message === "string") {
    base.message = `[sms_body:${(base.message as string).length} chars]`;
  }
  if (typeof base.normalized_destination === "string") {
    base.normalized_destination = "[REDACTED]";
  }
  return base;
}

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

function isSmsSendAuthorized(cfg: AppConfig, actor: ActorContext): boolean {
  if (!cfg.actionsEnabled || !cfg.smsActionsEnabled || !cfg.actionDatabaseUrl) {
    return false;
  }
  if (
    !OPENBOOK_ALLOWED_ROLES.includes(
      actor.actorRole as (typeof OPENBOOK_ALLOWED_ROLES)[number],
    )
  ) {
    return false;
  }
  return isReadAuthorized(cfg, actor);
}

function mapPayloadError(payload: Record<string, unknown>): SmsToolResult["error"] | null {
  const status = String(payload.status ?? "");
  if (status === "success" || status === "ready") return null;
  const category = String(payload.error_category ?? status ?? "failure");
  const message = String(payload.message ?? category);
  return { category, message };
}

function publicizePreparePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const { normalized_destination: _n, ...rest } = payload;
  return rest;
}

function resolveProvider(cfg: AppConfig): SmsProvider | { error: string } {
  if (injectedSmsProvider) return injectedSmsProvider;
  const loaded = loadSmsProviderConfig(process.env);
  if (!loaded.ok) return { error: loaded.error };
  if (cfg.smsDryRun && !loaded.config.dryRunOnly) {
    return createOnfonSmsProvider({ ...loaded.config, dryRunOnly: true });
  }
  return createOnfonSmsProvider(loaded.config);
}

export async function executeSmsTool(opts: {
  tool: SmsToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actionDb: ActionDbClient | null;
  actor: ActorContext;
}): Promise<SmsToolResult> {
  const { tool, cfg, db, actionDb, actor } = opts;
  const started = Date.now();
  const correlationId = randomUUID();
  const publicIds = { auditId: correlationId, correlationId };

  if (isSmsActionTool(tool)) {
    return executeSmsActionTool({
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

  return executeSmsReadTool({
    tool: tool as SmsReadToolName,
    args: opts.args,
    cfg,
    db,
    actor,
    started,
    correlationId,
    publicIds,
  });
}

async function executeSmsReadTool(opts: {
  tool: SmsReadToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actor: ActorContext;
  started: number;
  correlationId: string;
  publicIds: { auditId: string; correlationId: string };
}): Promise<SmsToolResult> {
  const { tool, cfg, db, actor, started, correlationId, publicIds } = opts;

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

  if (!isReadAuthorized(cfg, actor)) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: {
        category: "action_not_authorized",
        message: "SMS inspection is limited to verified technical_owner and business_partner",
      },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseSmsArgs(tool, opts.args);
  } catch {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: "validation", message: "Invalid SMS read parameters" },
    };
  }

  const mapping = SMS_READ_TO_SQL[tool];
  try {
    const data = await db.callReportingFn("wam_ai", mapping.fn, mapping.argBuilder(parsed));
    const payload = (data ?? {}) as Record<string, unknown>;
    const err = mapPayloadError(payload);
    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, parsed),
      dataClassification: "personal_data",
      resultCount: err ? 0 : 1,
      outcome: err ? "failure" : "success",
      errorCategory: err?.category ?? null,
      durationMs: Date.now() - started,
    });
    if (err) return { ok: false, ...publicIds, data, error: err };
    return { ok: true, ...publicIds, data };
  } catch (err) {
    const s = sanitizeErrorMessage(err);
    return { ok: false, ...publicIds, error: { category: s.category, message: s.message } };
  }
}

async function executeSmsActionTool(opts: {
  tool: SmsActionToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actionDb: ActionDbClient | null;
  actor: ActorContext;
  started: number;
  correlationId: string;
  publicIds: { auditId: string; correlationId: string };
}): Promise<SmsToolResult> {
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
  if (!cfg.smsActionsEnabled) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: {
        category: "action_disabled",
        message: "SMS business actions are disabled for this MCP instance",
      },
    };
  }
  if (cfg.smsBroadcastActionsEnabled) {
    // Broadcast remains unavailable even if mis-enabled in this phase.
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

  const rlActor = checkRateLimit(
    rateLimitKey(actor.instanceId, actor.actorId),
    Math.min(cfg.rateLimitPerMinute, cfg.smsRateLimitPerActorPerMinute),
  );
  if (!rlActor.allowed) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: "rate_limited", message: "SMS actor rate limit exceeded" },
    };
  }

  if (!isSmsSendAuthorized(cfg, actor)) {
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
        message:
          "SMS send is limited to verified technical_owner and business_partner",
      },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseSmsArgs(tool, opts.args);
  } catch (err) {
    const code = err instanceof ValidationError ? err.code : "validation";
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: code, message: "Invalid SMS action parameters" },
    };
  }

  if (parsed.explicit_action_authorized !== true) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: {
        category: "validation",
        message: "explicit_action_authorized must be true for SMS write actions",
      },
    };
  }

  const recipientKey = String(
    parsed.expected_destination_fingerprint ?? parsed.agent_id ?? "unknown",
  );
  const rlRecipient = checkRateLimit(
    `sms-dest::${rateLimitKey(actor.instanceId, recipientKey)}`,
    cfg.smsRateLimitPerRecipientPerMinute,
  );
  if (!rlRecipient.allowed) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: "rate_limited", message: "SMS recipient rate limit exceeded" },
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

  const prepareArgs = [
    parsed.agent_id ?? null,
    parsed.agent_business_id ?? null,
    parsed.message,
    parsed.phone_target ?? "airtel",
    parsed.idempotency_key,
    correlationId,
    actor.actorId,
    actor.actorRole,
    parsed.instruction_summary,
    parsed.expected_agent_status,
    parsed.expected_recipient_business_id,
    parsed.expected_destination_fingerprint,
  ];

  try {
    const prepared = (await actionDb.callActionFn(
      "prepare_send_agent_sms",
      prepareArgs,
    )) as Record<string, unknown>;

    const prepErr = mapPayloadError(prepared);
    if (prepErr) {
      await db.recordAudit({
        ...auditBase(correlationId, tool, actor, {
          ...parsed,
          _result: { error_category: prepErr.category },
        }),
        dataClassification: "internal_operational",
        resultCount: 0,
        outcome: "failure",
        errorCategory: prepErr.category,
        durationMs: Date.now() - started,
      });
      return {
        ok: false,
        ...publicIds,
        data: publicizePreparePayload(prepared),
        error: prepErr,
      };
    }

    if (prepared.status === "success" && prepared.idempotent_replay === true) {
      const publicData = publicizePreparePayload(prepared);
      await db.recordAudit({
        ...auditBase(correlationId, tool, actor, {
          ...parsed,
          _result: { idempotent_replay: true },
        }),
        dataClassification: "personal_data",
        resultCount: 1,
        outcome: "success",
        errorCategory: null,
        durationMs: Date.now() - started,
      });
      return { ok: true, ...publicIds, data: publicData };
    }

    if (prepared.status !== "ready") {
      return {
        ok: false,
        ...publicIds,
        data: publicizePreparePayload(prepared),
        error: {
          category: String(prepared.error_category ?? "failure"),
          message: String(prepared.message ?? "SMS prepare failed"),
        },
      };
    }

    const msisdn = String(prepared.normalized_destination ?? "");
    const provider = resolveProvider(cfg);
    if ("error" in provider) {
      const finalized = (await actionDb.callActionFn("finalize_send_agent_sms", [
        parsed.idempotency_key,
        correlationId,
        actor.actorId,
        actor.actorRole,
        "provider_rejected",
        null,
        "sms_not_configured",
        provider.error,
        false,
        null,
      ])) as Record<string, unknown>;
      return {
        ok: false,
        ...publicIds,
        data: publicizePreparePayload(finalized),
        error: { category: "sms_not_configured", message: provider.error },
      };
    }

    const segs = estimateSmsSegments(String(parsed.message));
    const sendResult = await provider.send({
      msisdn,
      message: String(parsed.message),
    });

    const finalized = (await actionDb.callActionFn("finalize_send_agent_sms", [
      parsed.idempotency_key,
      correlationId,
      actor.actorId,
      actor.actorRole,
      sendResult.outcome,
      "providerMessageId" in sendResult ? sendResult.providerMessageId : null,
      sendResult.outcome === "provider_accepted" ? null : sendResult.errorCategory,
      sendResult.outcome === "provider_accepted" ? null : sendResult.errorMessage,
      parsed.record_in_app !== false,
      parsed.message,
    ])) as Record<string, unknown>;

    const publicData = {
      ...publicizePreparePayload(finalized),
      sender_id: provider.senderId,
      encoding: segs.encoding,
      estimated_segments: segs.estimated_segments,
      message_length: segs.message_length,
    };

    const err = mapPayloadError(finalized);
    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, {
        ...parsed,
        _result: {
          provider_outcome: sendResult.outcome,
          sms_reference: finalized.sms_reference ?? null,
          provider_accepted: finalized.provider_accepted ?? false,
          delivery_confirmed: false,
        },
      }),
      dataClassification: err ? "internal_operational" : "personal_data",
      resultCount: err ? 0 : 1,
      outcome: err ? "failure" : "success",
      errorCategory: err?.category ?? null,
      durationMs: Date.now() - started,
    });

    if (err) return { ok: false, ...publicIds, data: publicData, error: err };
    const { truncated } = truncateJson(publicData, cfg.maxResponseChars);
    if (truncated) {
      return {
        ok: false,
        ...publicIds,
        error: { category: "response_too_large", message: "Action response exceeded size limit" },
      };
    }
    return { ok: true, ...publicIds, data: publicData };
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

export function listSmsTools(cfg: AppConfig): Array<{ name: string; description: string }> {
  const readTools = SMS_READ_TOOL_NAMES.map((tool) => ({
    name: fullSmsToolName(tool),
    description: SMS_READ_DESCRIPTIONS[tool],
  }));

  if (!validateActionConfig(cfg).ok || !cfg.smsActionsEnabled) {
    return readTools;
  }

  const actionTools = SMS_ACTION_TOOL_NAMES.map((tool) => ({
    name: fullSmsToolName(tool),
    description: SMS_ACTION_DESCRIPTIONS[tool],
  }));
  return [...readTools, ...actionTools];
}

const SMS_ACTION_DESCRIPTIONS: Record<SmsActionToolName, string> = {
  send_agent_sms:
    "Send one authorized SMS to exactly one verified Agent Hub agent via Onfon. Requires explicit_action_authorized after showing masked destination and exact body. Roles: technical_owner, business_partner. provider_accepted is not handset delivery. Broadcast/arbitrary phones are unavailable.",
};

const SMS_READ_DESCRIPTIONS: Record<SmsReadToolName, string> = {
  preview_agent_sms_recipient:
    "Resolve one agent SMS recipient preview: masked phone, destination_fingerprint, status. Use before drafting confirmation. Does not send SMS.",
  get_agent_sms_history:
    "Read bounded SMS-related history for one agent (in-app channel=sms copies). delivery_confirmed is always false without DLR.",
  get_sms_delivery_status:
    "Look up provider submission outcome by safe sms_reference (S- + 16 hex). Never claims handset delivery.",
};

export {
  parseSmsToolName,
  fullSmsToolName,
  SMS_TOOL_NAMES,
  MESSAGING_NAMESPACE,
};
