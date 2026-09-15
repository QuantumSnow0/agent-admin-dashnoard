import { z } from "zod";
import { ValidationError } from "./validation.js";

function zodObjectKeys(schema: z.ZodTypeAny): string[] {
  if (schema instanceof z.ZodEffects) {
    return zodObjectKeys(schema._def.schema);
  }
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape);
  }
  return [];
}

export const NOTIFICATIONS_NAMESPACE = "wam.business.notifications";

export type NotificationActionToolName = "send_agent_notification";

export type NotificationReadToolName =
  | "get_agent_notification_history"
  | "get_notification_delivery_status";

export type NotificationToolName = NotificationActionToolName | NotificationReadToolName;

export const NOTIFICATION_ACTION_TOOL_NAMES: NotificationActionToolName[] = [
  "send_agent_notification",
];

export const NOTIFICATION_READ_TOOL_NAMES: NotificationReadToolName[] = [
  "get_agent_notification_history",
  "get_notification_delivery_status",
];

export const NOTIFICATION_TOOL_NAMES: NotificationToolName[] = [
  ...NOTIFICATION_ACTION_TOOL_NAMES,
  ...NOTIFICATION_READ_TOOL_NAMES,
];

export const WAM_ALLOWED_NOTIFICATION_TYPES = ["SYSTEM_ANNOUNCEMENT"] as const;

/** Verified in-app routes from airtel-agent-app openNotificationAction.ts (SYSTEM_ANNOUNCEMENT). */
export const WAM_ALLOWED_DEEP_LINKS = ["dashboard"] as const;

export const NOTIFICATION_REFERENCE_PATTERN = /^N-[0-9A-Fa-f]{16}$/;

const SECRET_LIKE =
  /(postgresql:\/\/|jdbc:|mongodb:\/\/|-----BEGIN |Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{10,})/i;

function rejectSecretLike(value: string): void {
  if (SECRET_LIKE.test(value)) {
    throw new ValidationError("validation");
  }
}

const uuid = z.string().uuid();
const boundedText = (max: number) => z.string().trim().min(1).max(max);

const sendAgentNotificationInput = z
  .object({
    agent_id: uuid.optional(),
    agent_business_id: boundedText(32).optional(),
    title: boundedText(200),
    message: boundedText(2000),
    notification_type: z.enum(WAM_ALLOWED_NOTIFICATION_TYPES).default("SYSTEM_ANNOUNCEMENT"),
    deep_link: z.enum(WAM_ALLOWED_DEEP_LINKS).optional(),
    expected_agent_status: boundedText(64),
    expected_recipient_business_id: boundedText(32).optional(),
    idempotency_key: uuid,
    explicit_action_authorized: z.literal(true),
    instruction_summary: boundedText(200),
  })
  .strict()
  .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
    message: "agent_id or agent_business_id required",
  })
  .superRefine((v, ctx) => {
    try {
      rejectSecretLike(v.title);
      rejectSecretLike(v.message);
    } catch {
      ctx.addIssue({ code: "custom", message: "validation" });
    }
  });

const historyInput = z
  .object({
    agent_id: uuid.optional(),
    agent_business_id: boundedText(32).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
    message: "agent_id or agent_business_id required",
  });

const deliveryStatusInput = z
  .object({
    notification_reference: boundedText(64).regex(NOTIFICATION_REFERENCE_PATTERN, {
      message: "notification_reference must be N- followed by 16 hex characters",
    }),
    agent_id: uuid.optional(),
    agent_business_id: boundedText(32).optional(),
  })
  .strict();

export const NOTIFICATION_TOOL_INPUTS = {
  send_agent_notification: sendAgentNotificationInput,
  get_agent_notification_history: historyInput,
  get_notification_delivery_status: deliveryStatusInput,
};

export type JsonSchemaObject = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: string[];
};

const sendSchemaProps = {
  agent_id: { type: "string", format: "uuid" },
  agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
  title: { type: "string", minLength: 1, maxLength: 200 },
  message: { type: "string", minLength: 1, maxLength: 2000 },
  notification_type: { type: "string", enum: [...WAM_ALLOWED_NOTIFICATION_TYPES] },
  deep_link: { type: "string", enum: [...WAM_ALLOWED_DEEP_LINKS] },
  expected_agent_status: { type: "string", minLength: 1, maxLength: 64 },
  expected_recipient_business_id: { type: "string", minLength: 1, maxLength: 32 },
  idempotency_key: { type: "string", format: "uuid" },
  explicit_action_authorized: { type: "boolean", const: true },
  instruction_summary: { type: "string", minLength: 1, maxLength: 200 },
};

export const NOTIFICATION_TOOL_SCHEMAS: Record<NotificationToolName, JsonSchemaObject> = {
  send_agent_notification: {
    type: "object",
    additionalProperties: false,
    properties: sendSchemaProps,
    required: [
      "title",
      "message",
      "notification_type",
      "expected_agent_status",
      "idempotency_key",
      "explicit_action_authorized",
      "instruction_summary",
    ],
  },
  get_agent_notification_history: {
    type: "object",
    additionalProperties: false,
    properties: {
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
      since: { type: "string", format: "date-time" },
      until: { type: "string", format: "date-time" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  get_notification_delivery_status: {
    type: "object",
    additionalProperties: false,
    properties: {
      notification_reference: {
        type: "string",
        minLength: 19,
        maxLength: 19,
        pattern: "^N-[0-9A-Fa-f]{16}$",
      },
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
    },
    required: ["notification_reference"],
  },
};

export const NOTIFICATION_ACTION_SQL_FN: Record<NotificationActionToolName, string> = {
  send_agent_notification: "send_agent_notification",
};

export const NOTIFICATION_READ_SQL_FN: Record<NotificationReadToolName, string> = {
  get_agent_notification_history: "get_agent_notification_history",
  get_notification_delivery_status: "get_notification_delivery_status",
};

type SqlContext = {
  correlationId: string;
  actorId: string;
  actorRole: string;
};

export const NOTIFICATION_ACTION_TO_SQL: Record<
  NotificationActionToolName,
  {
    fn: string;
    argBuilder: (a: Record<string, unknown>, ctx: SqlContext) => unknown[];
  }
> = {
  send_agent_notification: {
    fn: "send_agent_notification",
    argBuilder: (a, ctx) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.title,
      a.message,
      a.notification_type ?? "SYSTEM_ANNOUNCEMENT",
      a.deep_link ?? null,
      a.idempotency_key,
      ctx.correlationId,
      ctx.actorId,
      ctx.actorRole,
      a.instruction_summary,
      a.expected_agent_status,
      a.expected_recipient_business_id ?? null,
    ],
  },
};

export const NOTIFICATION_READ_TO_SQL: Record<
  NotificationReadToolName,
  {
    fn: string;
    argBuilder: (a: Record<string, unknown>) => unknown[];
  }
> = {
  get_agent_notification_history: {
    fn: "get_agent_notification_history",
    argBuilder: (a) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.since ?? null,
      a.until ?? null,
      a.limit ?? null,
    ],
  },
  get_notification_delivery_status: {
    fn: "get_notification_delivery_status",
    argBuilder: (a) => [
      a.notification_reference,
      a.agent_id ?? null,
      a.agent_business_id ?? null,
    ],
  },
};

export function fullNotificationToolName(tool: NotificationToolName): string {
  return `${NOTIFICATIONS_NAMESPACE}.${tool}`;
}

export function parseNotificationToolName(full: string): NotificationToolName | null {
  const prefix = `${NOTIFICATIONS_NAMESPACE}.`;
  if (!full.startsWith(prefix)) return null;
  const short = full.slice(prefix.length) as NotificationToolName;
  return NOTIFICATION_TOOL_NAMES.includes(short) ? short : null;
}

export function isNotificationActionTool(
  tool: NotificationToolName,
): tool is NotificationActionToolName {
  return NOTIFICATION_ACTION_TOOL_NAMES.includes(tool as NotificationActionToolName);
}

export function parseNotificationArgs(
  tool: NotificationToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return NOTIFICATION_TOOL_INPUTS[tool].parse(args) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(
      err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ZodError"
        ? "validation"
        : "validation",
    );
  }
}

export function zodNotificationPropertyKeys(tool: NotificationToolName): string[] {
  return zodObjectKeys(NOTIFICATION_TOOL_INPUTS[tool]).sort();
}

export function jsonSchemaPropertyKeys(tool: NotificationToolName): string[] {
  return Object.keys(NOTIFICATION_TOOL_SCHEMAS[tool].properties).sort();
}

export function jsonSchemaRequiredKeys(tool: NotificationToolName): string[] {
  return [...(NOTIFICATION_TOOL_SCHEMAS[tool].required ?? [])].sort();
}

export function jsonSchemaAllowsOnlyDeclaredKeys(
  tool: NotificationToolName,
  args: Record<string, unknown>,
): boolean {
  const allowed = new Set(jsonSchemaPropertyKeys(tool));
  return Object.keys(args).every((k) => allowed.has(k));
}
