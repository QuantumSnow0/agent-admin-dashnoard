import { randomUUID } from "crypto";
import {
  OPENBOOK_ALLOWED_ROLES,
  PRODUCTION_GATEWAY_ROLES,
  type ActorContext,
  type AppConfig,
  isActionCategoryEnabled,
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
  ACTION_TOOL_CATEGORY,
  ACTION_TOOL_FINANCIAL,
  ACTION_TOOL_NAMESPACE_BY_NAME,
  ACTION_TOOL_NAMES,
  ACTION_TOOL_TO_SQL,
  fullActionToolName,
  parseActionArgs,
  parseActionToolName,
  type ActionToolName,
} from "./validation-actions.js";
import { ValidationError } from "./validation.js";

export type ActionToolResult = {
  ok: boolean;
  denied?: boolean;
  auditId: string | null;
  correlationId?: string | null;
  data?: unknown;
  error?: { category: string; message: string };
};

const AUDIT_UNAVAILABLE_MSG = "Action audit temporarily unavailable";

const ACTION_TOOL_DESCRIPTIONS: Record<ActionToolName, string> = {
  create_lead_offer:
    "Create a genuine blind lead offer for one verified agent. Does not assign the lead. Roles: technical_owner, business_partner.",
  approve_agent:
    "Approve a pending or rejected agent account. Sets dispatch scope to none. Does not revoke auth sessions. Roles: technical_owner, business_partner.",
  reject_agent:
    "Reject a pending agent application. Clears dispatch availability via DB trigger. Roles: technical_owner, business_partner.",
  ban_agent:
    "Ban an approved agent. Reports outstanding offers/assignments without modifying them. Does not revoke auth sessions. Roles: technical_owner, business_partner.",
  restore_agent:
    "Restore a banned agent to approved. Does not restore dispatch scope or availability. Roles: technical_owner, business_partner.",
  change_dispatch_scope:
    "Change an agent inbound lead dispatch scope (airtel/safaricom/both/none). Roles: technical_owner, business_partner.",
  reject_airtel_registration:
    "Reject a pending Airtel customer registration. Roles: technical_owner, business_partner.",
  mark_airtel_registration_duplicate:
    "Mark a pending Airtel registration as duplicate. Roles: technical_owner, business_partner.",
  cancel_airtel_registration:
    "Cancel a pending Airtel registration. Roles: technical_owner, business_partner.",
  confirm_airtel_installation:
    "Confirm Airtel registration installed — may recalculate agent earnings (financial). Roles: technical_owner, business_partner.",
  reject_safaricom_registration:
    "Reject a pending Safaricom registration. Roles: technical_owner, business_partner.",
  mark_safaricom_registration_duplicate:
    "Mark a pending Safaricom registration as duplicate. Roles: technical_owner, business_partner.",
  cancel_safaricom_registration:
    "Cancel a pending Safaricom registration. Roles: technical_owner, business_partner.",
  confirm_safaricom_installation:
    "Confirm Safaricom registration installed (operational; no earnings trigger in repo). Roles: technical_owner, business_partner.",
  confirm_lead_installation:
    "Confirm inbound lead installation — accrues KSh 200 commission metadata (financial). Roles: technical_owner, business_partner.",
  mark_lead_rejected: "Mark an inbound lead rejected. Roles: technical_owner, business_partner.",
  mark_lead_duplicate: "Mark an inbound lead duplicate. Roles: technical_owner, business_partner.",
  mark_lead_cancelled: "Mark an inbound lead cancelled. Roles: technical_owner, business_partner.",
  mark_lead_lost: "Mark an inbound lead lost. Roles: technical_owner, business_partner.",
  mark_lead_needs_reassignment:
    "Mark an inbound lead for reassignment. Does not create a new offer. Roles: technical_owner, business_partner.",
  revert_lead_pending_install:
    "Revert an installed lead to pending_install only. Clears commission (financial; requires WAM_AI_FINANCIAL_ACTIONS_ENABLED=1). Refuses rejected/duplicate/cancelled/lost sources. Roles: technical_owner, business_partner.",
  mark_lead_kyc_completed:
    "Mark an assigned inbound lead as KYC completed (non-financial pipeline step). Requires expected_lead_status. Refuses active offers. Roles: technical_owner, business_partner.",
  mark_lead_pending_install:
    "Schedule install review (pending_install). Operational status only — refuses commission or other financial state; never clears financial columns. Roles: technical_owner, business_partner.",
  expire_lead_offer:
    "Expire one active (offered) lead offer. May move lead to needs_reassignment when no offers remain. Does not auto-redispatch or mutate commission. Roles: technical_owner, business_partner.",
  set_agent_pending:
    "Set an approved agent back to pending review. Changes account status only; dispatch scope unchanged; availability cleared via DB trigger; active offers and assignments preserved. Roles: technical_owner, business_partner.",
  set_agent_fallback_dispatch:
    "Configure whether an agent is in the fallback dispatch pool and optional priority (0–9999). Roles: technical_owner, business_partner.",
  set_agent_service_radius:
    "Set agent service radius (0.5–50 km) or clear_radius to use dispatch default. Roles: technical_owner, business_partner.",
  reopen_airtel_registration_pending:
    "Reopen a rejected/duplicate/cancelled Airtel registration to pending. Refuses installed, linked-lead financial state, payment references, and installed-history evidence. Roles: technical_owner, business_partner.",
  reopen_safaricom_registration_pending:
    "Reopen a rejected/duplicate/cancelled Safaricom registration to pending. Refuses installed and financial/settlement evidence. Roles: technical_owner, business_partner.",
};

/** Reserved for true technical-admin actions — none of the business agent-config ops. */
const TECHNICAL_OWNER_ONLY_ACTIONS = new Set<ActionToolName>([]);

function isActionAuthorized(cfg: AppConfig, actor: ActorContext): boolean {
  if (!cfg.actionsEnabled || !cfg.actionDatabaseUrl) return false;
  if (!OPENBOOK_ALLOWED_ROLES.includes(actor.actorRole)) return false;
  if (cfg.identityMode === "production" && !actor.identityVerified) return false;
  if (cfg.identityMode === "production" && !PRODUCTION_GATEWAY_ROLES.includes(actor.actorRole)) {
    return false;
  }
  return true;
}

function auditBase(
  correlationId: string,
  tool: ActionToolName,
  actor: ActorContext,
  args: Record<string, unknown>,
) {
  return {
    correlationId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionOrChannelId: actor.sessionOrChannelId,
    operationName: fullActionToolName(tool),
    toolNamespace: ACTION_TOOL_NAMESPACE_BY_NAME[tool],
    paramHash: hashParams(args),
    paramRedacted: redactAuditParams(redactParams(args)),
    instanceId: actor.instanceId,
    identityVerified: actor.identityVerified,
  };
}

function mapPayloadError(payload: Record<string, unknown>): ActionToolResult["error"] | null {
  const status = String(payload.status ?? "");
  if (status === "success") return null;
  const category = String(payload.error_category ?? status ?? "failure");
  const message = String(payload.message ?? category);
  return { category, message };
}

function categoryDeniedMessage(tool: ActionToolName, cfg: AppConfig): string {
  const category = ACTION_TOOL_CATEGORY[tool];
  if (ACTION_TOOL_FINANCIAL[tool] && !cfg.financialActionsEnabled) {
    return "Financial business actions are disabled for this MCP instance";
  }
  const labels: Record<string, string> = {
    dispatch: "Dispatch",
    agents: "Agent",
    registrations: "Registration",
    leads: "Lead",
    lead_pipeline: "Lead pipeline",
    dispatch_ops: "Dispatch operations",
    agent_config: "Agent configuration",
    registration_reopen: "Registration reopen",
  };
  return `${labels[category] ?? category} business actions are disabled for this MCP instance`;
}

export async function executeActionTool(opts: {
  tool: ActionToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actionDb: ActionDbClient | null;
  actor: ActorContext;
}): Promise<ActionToolResult> {
  const { tool, cfg, db, actionDb, actor } = opts;
  const started = Date.now();
  const correlationId = randomUUID();
  const publicIds = { auditId: correlationId, correlationId };

  if (!cfg.actionsEnabled) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      auditId: null,
      error: { category: "action_disabled", message: "WAM AI business actions are disabled" },
    };
  }

  const category = ACTION_TOOL_CATEGORY[tool];
  if (!isActionCategoryEnabled(cfg, category)) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: "action_disabled", message: categoryDeniedMessage(tool, cfg) },
    };
  }
  if (ACTION_TOOL_FINANCIAL[tool] && !cfg.financialActionsEnabled) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: { category: "action_disabled", message: "Financial business actions are disabled" },
    };
  }

  if (TECHNICAL_OWNER_ONLY_ACTIONS.has(tool) && actor.actorRole !== "technical_owner") {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: {
        category: "action_not_authorized",
        message: "This infrastructure action requires technical_owner",
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
        message: "Business actions are limited to verified technical_owner and business_partner",
      },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseActionArgs(tool, opts.args);
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
      error: { category: "validation", message: "Invalid action parameters" },
    };
  }

  if (parsed.explicit_action_authorized !== true) {
    return {
      ok: false,
      denied: true,
      ...publicIds,
      error: {
        category: "validation",
        message: "explicit_action_authorized must be true for write actions",
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

  const mapping = ACTION_TOOL_TO_SQL[tool];
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
      await db.recordAudit({
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
        error: { category: "response_too_large", message: "Action response exceeded size limit" },
      };
    }

    await db.recordAudit({
      ...auditBase(correlationId, tool, actor, {
        ...parsed,
        _result: {
          operation: payload.operation ?? tool,
          idempotent_replay: payload.idempotent_replay ?? false,
          error_category: payload.error_category ?? null,
        },
      }),
      dataClassification: err ? "internal_operational" : "personal_data",
      resultCount: err ? 0 : 1,
      outcome: err ? "failure" : "success",
      errorCategory: err?.category ?? null,
      durationMs: Date.now() - started,
    });

    if (err) {
      return { ok: false, ...publicIds, data, error: err };
    }
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

export function listActionTools(cfg: AppConfig): Array<{ name: string; description: string }> {
  if (!validateActionConfig(cfg).ok) return [];
  return ACTION_TOOL_NAMES.filter((tool) => {
    const category = ACTION_TOOL_CATEGORY[tool];
    if (!isActionCategoryEnabled(cfg, category)) return false;
    if (ACTION_TOOL_FINANCIAL[tool] && !cfg.financialActionsEnabled) return false;
    return true;
  }).map((tool) => ({
    name: fullActionToolName(tool),
    description: ACTION_TOOL_DESCRIPTIONS[tool],
  }));
}

export { parseActionToolName, fullActionToolName, ACTION_TOOL_NAMES };
