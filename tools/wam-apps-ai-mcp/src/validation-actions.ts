import { z } from "zod";
import { ValidationError } from "./validation.js";

export const DISPATCH_ACTION_NAMESPACE = "wam.business.dispatch";
export const AGENTS_ACTION_NAMESPACE = "wam.business.agents";
export const REGISTRATIONS_ACTION_NAMESPACE = "wam.business.registrations";
export const LEADS_ACTION_NAMESPACE = "wam.business.leads";

export type ActionCategory =
  | "dispatch"
  | "agents"
  | "registrations"
  | "leads"
  | "lead_pipeline"
  | "dispatch_ops"
  | "agent_config"
  | "registration_reopen";

export type ActionToolName =
  | "create_lead_offer"
  | "approve_agent"
  | "reject_agent"
  | "ban_agent"
  | "restore_agent"
  | "change_dispatch_scope"
  | "reject_airtel_registration"
  | "mark_airtel_registration_duplicate"
  | "cancel_airtel_registration"
  | "confirm_airtel_installation"
  | "reject_safaricom_registration"
  | "mark_safaricom_registration_duplicate"
  | "cancel_safaricom_registration"
  | "confirm_safaricom_installation"
  | "confirm_lead_installation"
  | "mark_lead_rejected"
  | "mark_lead_duplicate"
  | "mark_lead_cancelled"
  | "mark_lead_lost"
  | "mark_lead_needs_reassignment"
  | "revert_lead_pending_install"
  | "mark_lead_kyc_completed"
  | "mark_lead_pending_install"
  | "expire_lead_offer"
  | "set_agent_pending"
  | "set_agent_fallback_dispatch"
  | "set_agent_service_radius"
  | "reopen_airtel_registration_pending"
  | "reopen_safaricom_registration_pending";

export const ACTION_TOOL_NAMES: ActionToolName[] = [
  "create_lead_offer",
  "approve_agent",
  "reject_agent",
  "ban_agent",
  "restore_agent",
  "change_dispatch_scope",
  "reject_airtel_registration",
  "mark_airtel_registration_duplicate",
  "cancel_airtel_registration",
  "confirm_airtel_installation",
  "reject_safaricom_registration",
  "mark_safaricom_registration_duplicate",
  "cancel_safaricom_registration",
  "confirm_safaricom_installation",
  "confirm_lead_installation",
  "mark_lead_rejected",
  "mark_lead_duplicate",
  "mark_lead_cancelled",
  "mark_lead_lost",
  "mark_lead_needs_reassignment",
  "revert_lead_pending_install",
  "mark_lead_kyc_completed",
  "mark_lead_pending_install",
  "expire_lead_offer",
  "set_agent_pending",
  "set_agent_fallback_dispatch",
  "set_agent_service_radius",
  "reopen_airtel_registration_pending",
  "reopen_safaricom_registration_pending",
];

export const ACTION_TOOL_NAMESPACE_BY_NAME: Record<ActionToolName, string> = {
  create_lead_offer: DISPATCH_ACTION_NAMESPACE,
  approve_agent: AGENTS_ACTION_NAMESPACE,
  reject_agent: AGENTS_ACTION_NAMESPACE,
  ban_agent: AGENTS_ACTION_NAMESPACE,
  restore_agent: AGENTS_ACTION_NAMESPACE,
  change_dispatch_scope: AGENTS_ACTION_NAMESPACE,
  reject_airtel_registration: REGISTRATIONS_ACTION_NAMESPACE,
  mark_airtel_registration_duplicate: REGISTRATIONS_ACTION_NAMESPACE,
  cancel_airtel_registration: REGISTRATIONS_ACTION_NAMESPACE,
  confirm_airtel_installation: REGISTRATIONS_ACTION_NAMESPACE,
  reject_safaricom_registration: REGISTRATIONS_ACTION_NAMESPACE,
  mark_safaricom_registration_duplicate: REGISTRATIONS_ACTION_NAMESPACE,
  cancel_safaricom_registration: REGISTRATIONS_ACTION_NAMESPACE,
  confirm_safaricom_installation: REGISTRATIONS_ACTION_NAMESPACE,
  confirm_lead_installation: LEADS_ACTION_NAMESPACE,
  mark_lead_rejected: LEADS_ACTION_NAMESPACE,
  mark_lead_duplicate: LEADS_ACTION_NAMESPACE,
  mark_lead_cancelled: LEADS_ACTION_NAMESPACE,
  mark_lead_lost: LEADS_ACTION_NAMESPACE,
  mark_lead_needs_reassignment: LEADS_ACTION_NAMESPACE,
  revert_lead_pending_install: LEADS_ACTION_NAMESPACE,
  mark_lead_kyc_completed: LEADS_ACTION_NAMESPACE,
  mark_lead_pending_install: LEADS_ACTION_NAMESPACE,
  expire_lead_offer: DISPATCH_ACTION_NAMESPACE,
  set_agent_pending: AGENTS_ACTION_NAMESPACE,
  set_agent_fallback_dispatch: AGENTS_ACTION_NAMESPACE,
  set_agent_service_radius: AGENTS_ACTION_NAMESPACE,
  reopen_airtel_registration_pending: REGISTRATIONS_ACTION_NAMESPACE,
  reopen_safaricom_registration_pending: REGISTRATIONS_ACTION_NAMESPACE,
};

export const ACTION_TOOL_CATEGORY: Record<ActionToolName, ActionCategory> = {
  create_lead_offer: "dispatch",
  approve_agent: "agents",
  reject_agent: "agents",
  ban_agent: "agents",
  restore_agent: "agents",
  change_dispatch_scope: "agents",
  reject_airtel_registration: "registrations",
  mark_airtel_registration_duplicate: "registrations",
  cancel_airtel_registration: "registrations",
  confirm_airtel_installation: "registrations",
  reject_safaricom_registration: "registrations",
  mark_safaricom_registration_duplicate: "registrations",
  cancel_safaricom_registration: "registrations",
  confirm_safaricom_installation: "registrations",
  confirm_lead_installation: "leads",
  mark_lead_rejected: "leads",
  mark_lead_duplicate: "leads",
  mark_lead_cancelled: "leads",
  mark_lead_lost: "leads",
  mark_lead_needs_reassignment: "leads",
  revert_lead_pending_install: "leads",
  mark_lead_kyc_completed: "lead_pipeline",
  mark_lead_pending_install: "lead_pipeline",
  expire_lead_offer: "dispatch_ops",
  set_agent_pending: "agent_config",
  set_agent_fallback_dispatch: "agent_config",
  set_agent_service_radius: "agent_config",
  reopen_airtel_registration_pending: "registration_reopen",
  reopen_safaricom_registration_pending: "registration_reopen",
};

export const ACTION_TOOL_FINANCIAL: Record<ActionToolName, boolean> = {
  create_lead_offer: false,
  approve_agent: false,
  reject_agent: false,
  ban_agent: false,
  restore_agent: false,
  change_dispatch_scope: false,
  reject_airtel_registration: false,
  mark_airtel_registration_duplicate: false,
  cancel_airtel_registration: false,
  confirm_airtel_installation: true,
  reject_safaricom_registration: false,
  mark_safaricom_registration_duplicate: false,
  cancel_safaricom_registration: false,
  confirm_safaricom_installation: false,
  confirm_lead_installation: true,
  mark_lead_rejected: false,
  mark_lead_duplicate: false,
  mark_lead_cancelled: false,
  mark_lead_lost: false,
  mark_lead_needs_reassignment: false,
  revert_lead_pending_install: true,
  mark_lead_kyc_completed: false,
  mark_lead_pending_install: false,
  expire_lead_offer: false,
  set_agent_pending: false,
  set_agent_fallback_dispatch: false,
  set_agent_service_radius: false,
  reopen_airtel_registration_pending: false,
  reopen_safaricom_registration_pending: false,
};

/** SQL function name (wam_ai schema) — may differ from MCP short name. */
export const ACTION_TOOL_SQL_FN: Record<ActionToolName, string> = {
  create_lead_offer: "create_lead_offer",
  approve_agent: "approve_agent",
  reject_agent: "reject_agent",
  ban_agent: "ban_agent",
  restore_agent: "restore_agent",
  change_dispatch_scope: "change_agent_dispatch_scope",
  reject_airtel_registration: "reject_airtel_registration",
  mark_airtel_registration_duplicate: "mark_airtel_registration_duplicate",
  cancel_airtel_registration: "cancel_airtel_registration",
  confirm_airtel_installation: "confirm_airtel_registration_installation",
  reject_safaricom_registration: "reject_safaricom_registration",
  mark_safaricom_registration_duplicate: "mark_safaricom_registration_duplicate",
  cancel_safaricom_registration: "cancel_safaricom_registration",
  confirm_safaricom_installation: "confirm_safaricom_registration_installation",
  confirm_lead_installation: "confirm_lead_installation",
  mark_lead_rejected: "mark_lead_rejected",
  mark_lead_duplicate: "mark_lead_duplicate",
  mark_lead_cancelled: "mark_lead_cancelled",
  mark_lead_lost: "mark_lead_lost",
  mark_lead_needs_reassignment: "mark_lead_needs_reassignment",
  revert_lead_pending_install: "revert_lead_pending_install",
  mark_lead_kyc_completed: "mark_lead_kyc_completed",
  mark_lead_pending_install: "mark_lead_pending_install",
  expire_lead_offer: "expire_lead_offer",
  set_agent_pending: "set_agent_pending",
  set_agent_fallback_dispatch: "set_agent_fallback_dispatch",
  set_agent_service_radius: "set_agent_service_radius",
  reopen_airtel_registration_pending: "reopen_airtel_registration_pending",
  reopen_safaricom_registration_pending: "reopen_safaricom_registration_pending",
};

export type JsonSchemaObject = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: string[];
};

const uuid = z.string().uuid();
const boundedText = (max: number) => z.string().trim().min(1).max(max);

const actionCore = {
  idempotency_key: uuid,
  explicit_action_authorized: z.literal(true),
  instruction_summary: boundedText(200),
};

const agentTarget = z
  .object({
    agent_id: uuid.optional(),
    agent_business_id: boundedText(32).optional(),
    expected_agent_status: boundedText(64),
    reason: boundedText(200).optional(),
    ...actionCore,
  })
  .strict()
  .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
    message: "agent_id or agent_business_id required",
  });

const registrationTargetWithReason = z
  .object({
    registration_id: uuid.optional(),
    registration_ref: boundedText(64).optional(),
    expected_registration_status: boundedText(64),
    reason: boundedText(200).optional(),
    ...actionCore,
  })
  .strict()
  .refine((v) => Boolean(v.registration_id || v.registration_ref), {
    message: "registration_id or registration_ref required",
  });

const registrationTargetNoReason = z
  .object({
    registration_id: uuid.optional(),
    registration_ref: boundedText(64).optional(),
    expected_registration_status: boundedText(64),
    ...actionCore,
  })
  .strict()
  .refine((v) => Boolean(v.registration_id || v.registration_ref), {
    message: "registration_id or registration_ref required",
  });

const leadTarget = z
  .object({
    lead_id: uuid.optional(),
    lead_ref: boundedText(64).optional(),
    expected_lead_status: boundedText(64),
    ...actionCore,
  })
  .strict()
  .refine((v) => Boolean(v.lead_id || v.lead_ref), {
    message: "lead_id or lead_ref required",
  });

export const ACTION_TOOL_INPUTS = {
  create_lead_offer: z
    .object({
      lead_id: uuid.optional(),
      lead_ref: boundedText(64).optional(),
      agent_id: uuid.optional(),
      agent_business_id: boundedText(32).optional(),
      recommendation_id: uuid.optional(),
      expected_lead_status: boundedText(64).optional(),
      expected_agent_available: z.boolean().optional(),
      expected_distance_km: z.number().min(0).max(5000).optional(),
      reason: boundedText(200).optional(),
      ...actionCore,
    })
    .strict()
    .refine((v) => Boolean(v.lead_id || v.lead_ref), {
      message: "lead_id or lead_ref required",
    })
    .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
      message: "agent_id or agent_business_id required",
    }),
  approve_agent: agentTarget,
  reject_agent: agentTarget,
  ban_agent: agentTarget,
  restore_agent: z
    .object({
      agent_id: uuid.optional(),
      agent_business_id: boundedText(32).optional(),
      expected_agent_status: boundedText(64),
      ...actionCore,
    })
    .strict()
    .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
      message: "agent_id or agent_business_id required",
    }),
  change_dispatch_scope: z
    .object({
      agent_id: uuid.optional(),
      agent_business_id: boundedText(32).optional(),
      dispatch_scope: z.enum(["both", "airtel", "safaricom", "none"]),
      expected_dispatch_scope: z.enum(["both", "airtel", "safaricom", "none"]),
      ...actionCore,
    })
    .strict()
    .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
      message: "agent_id or agent_business_id required",
    }),
  reject_airtel_registration: registrationTargetWithReason,
  mark_airtel_registration_duplicate: registrationTargetNoReason,
  cancel_airtel_registration: registrationTargetNoReason,
  confirm_airtel_installation: registrationTargetNoReason,
  reject_safaricom_registration: registrationTargetNoReason,
  mark_safaricom_registration_duplicate: registrationTargetNoReason,
  cancel_safaricom_registration: registrationTargetNoReason,
  confirm_safaricom_installation: registrationTargetNoReason,
  confirm_lead_installation: leadTarget,
  mark_lead_rejected: leadTarget,
  mark_lead_duplicate: leadTarget,
  mark_lead_cancelled: leadTarget,
  mark_lead_lost: leadTarget,
  mark_lead_needs_reassignment: leadTarget,
  revert_lead_pending_install: leadTarget,
  mark_lead_kyc_completed: leadTarget,
  mark_lead_pending_install: leadTarget,
  expire_lead_offer: z
    .object({
      offer_id: uuid.optional(),
      offer_reference: z
        .string()
        .trim()
        .regex(/^O-[0-9A-Fa-f]{12}$/, "offer_reference must match O-{12 hex}")
        .optional(),
      expected_offer_status: z.literal("offered"),
      ...actionCore,
    })
    .strict()
    .refine((v) => Boolean(v.offer_id || v.offer_reference), {
      message: "offer_id or offer_reference required",
    }),
  set_agent_pending: z
    .object({
      agent_id: uuid.optional(),
      agent_business_id: boundedText(32).optional(),
      expected_agent_status: z.literal("approved"),
      ...actionCore,
    })
    .strict()
    .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
      message: "agent_id or agent_business_id required",
    }),
  set_agent_fallback_dispatch: z
    .object({
      agent_id: uuid.optional(),
      agent_business_id: boundedText(32).optional(),
      is_fallback_agent: z.boolean(),
      fallback_priority: z.number().int().min(0).max(9999).optional(),
      ...actionCore,
    })
    .strict()
    .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
      message: "agent_id or agent_business_id required",
    }),
  set_agent_service_radius: z
    .object({
      agent_id: uuid.optional(),
      agent_business_id: boundedText(32).optional(),
      service_radius_km: z.number().min(0.5).max(50).optional(),
      clear_radius: z.boolean().optional(),
      ...actionCore,
    })
    .strict()
    .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
      message: "agent_id or agent_business_id required",
    })
    .refine((v) => v.clear_radius === true || v.service_radius_km != null, {
      message: "service_radius_km or clear_radius required",
    }),
  reopen_airtel_registration_pending: registrationTargetNoReason,
  reopen_safaricom_registration_pending: registrationTargetNoReason,
} as const;

const coreSchemaProps = {
  idempotency_key: { type: "string", format: "uuid" },
  explicit_action_authorized: { type: "boolean", const: true },
  instruction_summary: { type: "string", minLength: 1, maxLength: 200 },
};

const agentSchemaPropsWithReason = {
  ...coreSchemaProps,
  agent_id: { type: "string", format: "uuid" },
  agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
  expected_agent_status: { type: "string", maxLength: 64 },
  reason: { type: "string", maxLength: 200 },
};

const agentSchemaPropsNoReason = {
  ...coreSchemaProps,
  agent_id: { type: "string", format: "uuid" },
  agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
  expected_agent_status: { type: "string", maxLength: 64 },
};

const dispatchScopeSchemaProps = {
  ...coreSchemaProps,
  agent_id: { type: "string", format: "uuid" },
  agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
  dispatch_scope: { type: "string", enum: ["both", "airtel", "safaricom", "none"] },
  expected_dispatch_scope: { type: "string", enum: ["both", "airtel", "safaricom", "none"] },
};

const registrationSchemaProps = {
  ...coreSchemaProps,
  registration_id: { type: "string", format: "uuid" },
  registration_ref: { type: "string", minLength: 1, maxLength: 64 },
  expected_registration_status: { type: "string", maxLength: 64 },
  reason: { type: "string", maxLength: 200 },
};

const registrationSchemaPropsNoReason = {
  ...coreSchemaProps,
  registration_id: { type: "string", format: "uuid" },
  registration_ref: { type: "string", minLength: 1, maxLength: 64 },
  expected_registration_status: { type: "string", maxLength: 64 },
};

const leadSchemaProps = {
  ...coreSchemaProps,
  lead_id: { type: "string", format: "uuid" },
  lead_ref: { type: "string", minLength: 1, maxLength: 64 },
  expected_lead_status: { type: "string", maxLength: 64 },
};

const offerSchemaProps = {
  ...coreSchemaProps,
  offer_id: { type: "string", format: "uuid" },
  offer_reference: { type: "string", pattern: "^O-[0-9A-Fa-f]{12}$" },
  expected_offer_status: { type: "string", const: "offered" },
};

/** Unwrap ZodObject shape keys (through refine wrappers). */
function zodObjectKeys(schema: z.ZodTypeAny): string[] {
  if (schema instanceof z.ZodEffects) {
    return zodObjectKeys(schema._def.schema);
  }
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape);
  }
  throw new Error("expected ZodObject");
}

export function zodActionPropertyKeys(tool: ActionToolName): string[] {
  return zodObjectKeys(ACTION_TOOL_INPUTS[tool]).sort();
}

export function jsonSchemaPropertyKeys(tool: ActionToolName): string[] {
  const props = ACTION_TOOL_SCHEMAS[tool].properties;
  return Object.keys(props)
    .filter((k) => props[k] != null && typeof props[k] === "object")
    .sort();
}

export function jsonSchemaRequiredKeys(tool: ActionToolName): string[] {
  return [...(ACTION_TOOL_SCHEMAS[tool].required ?? [])].sort();
}

/** True when every property key is declared (additionalProperties: false contract). */
export function jsonSchemaAllowsOnlyDeclaredKeys(
  tool: ActionToolName,
  args: Record<string, unknown>,
): boolean {
  const allowed = new Set(jsonSchemaPropertyKeys(tool));
  return Object.keys(args).every((k) => allowed.has(k));
}

function actionSchema(required: string[], properties: Record<string, unknown>): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

export const ACTION_TOOL_SCHEMAS: Record<ActionToolName, JsonSchemaObject> = {
  create_lead_offer: {
    type: "object",
    additionalProperties: false,
    required: ["idempotency_key", "explicit_action_authorized", "instruction_summary"],
    properties: {
      ...leadSchemaProps,
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
      recommendation_id: { type: "string", format: "uuid" },
      expected_agent_available: { type: "boolean" },
      expected_distance_km: { type: "number", minimum: 0, maximum: 5000 },
      reason: { type: "string", maxLength: 200 },
    },
  },
  approve_agent: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_agent_status"],
    agentSchemaPropsWithReason,
  ),
  reject_agent: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_agent_status"],
    agentSchemaPropsWithReason,
  ),
  ban_agent: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_agent_status"],
    agentSchemaPropsWithReason,
  ),
  restore_agent: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_agent_status"],
    agentSchemaPropsNoReason,
  ),
  change_dispatch_scope: actionSchema(
    [
      "idempotency_key",
      "explicit_action_authorized",
      "instruction_summary",
      "dispatch_scope",
      "expected_dispatch_scope",
    ],
    dispatchScopeSchemaProps,
  ),
  reject_airtel_registration: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaProps,
  ),
  mark_airtel_registration_duplicate: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaPropsNoReason,
  ),
  cancel_airtel_registration: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaPropsNoReason,
  ),
  confirm_airtel_installation: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaPropsNoReason,
  ),
  reject_safaricom_registration: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaPropsNoReason,
  ),
  mark_safaricom_registration_duplicate: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaPropsNoReason,
  ),
  cancel_safaricom_registration: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaPropsNoReason,
  ),
  confirm_safaricom_installation: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaPropsNoReason,
  ),
  confirm_lead_installation: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_lead_status"],
    leadSchemaProps,
  ),
  mark_lead_rejected: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_lead_status"],
    leadSchemaProps,
  ),
  mark_lead_duplicate: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_lead_status"],
    leadSchemaProps,
  ),
  mark_lead_cancelled: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_lead_status"],
    leadSchemaProps,
  ),
  mark_lead_lost: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_lead_status"],
    leadSchemaProps,
  ),
  mark_lead_needs_reassignment: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_lead_status"],
    leadSchemaProps,
  ),
  revert_lead_pending_install: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_lead_status"],
    leadSchemaProps,
  ),
  mark_lead_kyc_completed: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_lead_status"],
    leadSchemaProps,
  ),
  mark_lead_pending_install: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_lead_status"],
    leadSchemaProps,
  ),
  expire_lead_offer: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_offer_status"],
    offerSchemaProps,
  ),
  set_agent_pending: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_agent_status"],
    {
      ...coreSchemaProps,
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
      expected_agent_status: { type: "string", const: "approved" },
    },
  ),
  set_agent_fallback_dispatch: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "is_fallback_agent"],
    {
      ...coreSchemaProps,
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
      is_fallback_agent: { type: "boolean" },
      fallback_priority: { type: "integer", minimum: 0, maximum: 9999 },
    },
  ),
  set_agent_service_radius: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary"],
    {
      ...coreSchemaProps,
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
      service_radius_km: { type: "number", minimum: 0.5, maximum: 50 },
      clear_radius: { type: "boolean" },
    },
  ),
  reopen_airtel_registration_pending: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaPropsNoReason,
  ),
  reopen_safaricom_registration_pending: actionSchema(
    ["idempotency_key", "explicit_action_authorized", "instruction_summary", "expected_registration_status"],
    registrationSchemaPropsNoReason,
  ),
};

export type ActionSqlContext = {
  correlationId: string;
  actorId: string;
  actorRole: string;
};

type SqlMapping = {
  schema: "wam_ai";
  fn: string;
  argBuilder: (a: Record<string, unknown>, ctx: ActionSqlContext) => unknown[];
};

export const ACTION_TOOL_TO_SQL: Record<ActionToolName, SqlMapping> = {
  create_lead_offer: {
    schema: "wam_ai",
    fn: "create_lead_offer",
    argBuilder: (a, ctx) => [
      a.lead_id ?? null,
      a.lead_ref ?? null,
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
      a.recommendation_id ?? null,
      a.expected_lead_status ?? null,
      a.expected_agent_available ?? null,
      a.expected_distance_km ?? null,
      a.reason ?? null,
    ],
  },
  approve_agent: {
    schema: "wam_ai",
    fn: "approve_agent",
    argBuilder: (a, ctx) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
      a.expected_agent_status ?? null,
    ],
  },
  reject_agent: {
    schema: "wam_ai",
    fn: "reject_agent",
    argBuilder: (a, ctx) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
      a.expected_agent_status ?? null,
      a.reason ?? null,
    ],
  },
  ban_agent: {
    schema: "wam_ai",
    fn: "ban_agent",
    argBuilder: (a, ctx) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
      a.expected_agent_status ?? null,
      a.reason ?? null,
    ],
  },
  restore_agent: {
    schema: "wam_ai",
    fn: "restore_agent",
    argBuilder: (a, ctx) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
      a.expected_agent_status ?? null,
    ],
  },
  change_dispatch_scope: {
    schema: "wam_ai",
    fn: "change_agent_dispatch_scope",
    argBuilder: (a, ctx) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.dispatch_scope,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
      a.expected_dispatch_scope ?? null,
    ],
  },
  reject_airtel_registration: {
    schema: "wam_ai",
    fn: "reject_airtel_registration",
    argBuilder: regArgBuilder,
  },
  mark_airtel_registration_duplicate: {
    schema: "wam_ai",
    fn: "mark_airtel_registration_duplicate",
    argBuilder: regArgBuilderNoReason,
  },
  cancel_airtel_registration: {
    schema: "wam_ai",
    fn: "cancel_airtel_registration",
    argBuilder: regArgBuilderNoReason,
  },
  confirm_airtel_installation: {
    schema: "wam_ai",
    fn: "confirm_airtel_registration_installation",
    argBuilder: regArgBuilderNoReason,
  },
  reject_safaricom_registration: {
    schema: "wam_ai",
    fn: "reject_safaricom_registration",
    argBuilder: regArgBuilderNoReason,
  },
  mark_safaricom_registration_duplicate: {
    schema: "wam_ai",
    fn: "mark_safaricom_registration_duplicate",
    argBuilder: regArgBuilderNoReason,
  },
  cancel_safaricom_registration: {
    schema: "wam_ai",
    fn: "cancel_safaricom_registration",
    argBuilder: regArgBuilderNoReason,
  },
  confirm_safaricom_installation: {
    schema: "wam_ai",
    fn: "confirm_safaricom_registration_installation",
    argBuilder: regArgBuilderNoReason,
  },
  confirm_lead_installation: {
    schema: "wam_ai",
    fn: "confirm_lead_installation",
    argBuilder: leadArgBuilder,
  },
  mark_lead_rejected: { schema: "wam_ai", fn: "mark_lead_rejected", argBuilder: leadArgBuilder },
  mark_lead_duplicate: { schema: "wam_ai", fn: "mark_lead_duplicate", argBuilder: leadArgBuilder },
  mark_lead_cancelled: { schema: "wam_ai", fn: "mark_lead_cancelled", argBuilder: leadArgBuilder },
  mark_lead_lost: { schema: "wam_ai", fn: "mark_lead_lost", argBuilder: leadArgBuilder },
  mark_lead_needs_reassignment: {
    schema: "wam_ai",
    fn: "mark_lead_needs_reassignment",
    argBuilder: leadArgBuilder,
  },
  revert_lead_pending_install: {
    schema: "wam_ai",
    fn: "revert_lead_pending_install",
    argBuilder: leadArgBuilder,
  },
  mark_lead_kyc_completed: {
    schema: "wam_ai",
    fn: "mark_lead_kyc_completed",
    argBuilder: leadArgBuilder,
  },
  mark_lead_pending_install: {
    schema: "wam_ai",
    fn: "mark_lead_pending_install",
    argBuilder: leadArgBuilder,
  },
  expire_lead_offer: {
    schema: "wam_ai",
    fn: "expire_lead_offer",
    argBuilder: offerArgBuilder,
  },
  set_agent_pending: {
    schema: "wam_ai",
    fn: "set_agent_pending",
    argBuilder: (a, ctx) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
      a.expected_agent_status ?? null,
    ],
  },
  set_agent_fallback_dispatch: {
    schema: "wam_ai",
    fn: "set_agent_fallback_dispatch",
    argBuilder: (a, ctx) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.is_fallback_agent,
      a.fallback_priority ?? null,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
    ],
  },
  set_agent_service_radius: {
    schema: "wam_ai",
    fn: "set_agent_service_radius",
    argBuilder: (a, ctx) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.service_radius_km ?? null,
      a.clear_radius ?? false,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
    ],
  },
  reopen_airtel_registration_pending: {
    schema: "wam_ai",
    fn: "reopen_airtel_registration_pending",
    argBuilder: regArgBuilderNoReason,
  },
  reopen_safaricom_registration_pending: {
    schema: "wam_ai",
    fn: "reopen_safaricom_registration_pending",
    argBuilder: regArgBuilderNoReason,
  },
};

function regArgBuilder(a: Record<string, unknown>, ctx: ActionSqlContext): unknown[] {
  return [
    a.registration_id ?? null,
    a.registration_ref ?? null,
    a.idempotency_key,
    ctx.correlationId,
    ctx.actorId,
    ctx.actorRole,
    a.instruction_summary,
    a.expected_registration_status ?? null,
    a.reason ?? null,
  ];
}

function regArgBuilderNoReason(a: Record<string, unknown>, ctx: ActionSqlContext): unknown[] {
  return [
    a.registration_id ?? null,
    a.registration_ref ?? null,
    a.idempotency_key,
    ctx.correlationId,
    ctx.actorId,
    ctx.actorRole,
    a.instruction_summary,
    a.expected_registration_status ?? null,
  ];
}

function leadArgBuilder(a: Record<string, unknown>, ctx: ActionSqlContext): unknown[] {
  return [
    a.lead_id ?? null,
    a.lead_ref ?? null,
    a.idempotency_key,
    ctx.correlationId,
    ctx.actorId,
    ctx.actorRole,
    a.instruction_summary,
    a.expected_lead_status ?? null,
  ];
}

function offerArgBuilder(a: Record<string, unknown>, ctx: ActionSqlContext): unknown[] {
  return [
    a.offer_id ?? null,
    a.offer_reference ?? null,
    a.idempotency_key,
    ctx.correlationId,
    ctx.actorId,
    ctx.actorRole,
    a.instruction_summary,
    a.expected_offer_status ?? null,
  ];
}

export function fullActionToolName(tool: ActionToolName): string {
  return `${ACTION_TOOL_NAMESPACE_BY_NAME[tool]}.${tool}`;
}

export function parseActionToolName(full: string): ActionToolName | null {
  for (const tool of ACTION_TOOL_NAMES) {
    if (full === fullActionToolName(tool)) return tool;
  }
  return null;
}

export function parseActionArgs(
  tool: ActionToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return ACTION_TOOL_INPUTS[tool].parse(args) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(
      err &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name: string }).name === "ZodError"
        ? "validation"
        : "validation",
    );
  }
}
