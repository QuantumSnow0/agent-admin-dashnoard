import { z } from "zod";
import { ValidationError } from "./validation.js";
import { SMS_MAX_MESSAGE_LENGTH } from "./smsProvider.js";

function zodObjectKeys(schema: z.ZodTypeAny): string[] {
  if (schema instanceof z.ZodEffects) {
    return zodObjectKeys(schema._def.schema);
  }
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape);
  }
  return [];
}

export const MESSAGING_NAMESPACE = "wam.business.messaging";

export type SmsActionToolName = "send_agent_sms";
export type SmsReadToolName =
  | "preview_agent_sms_recipient"
  | "get_agent_sms_history"
  | "get_sms_delivery_status";
export type SmsToolName = SmsActionToolName | SmsReadToolName;

export const SMS_ACTION_TOOL_NAMES: SmsActionToolName[] = ["send_agent_sms"];
export const SMS_READ_TOOL_NAMES: SmsReadToolName[] = [
  "preview_agent_sms_recipient",
  "get_agent_sms_history",
  "get_sms_delivery_status",
];
export const SMS_TOOL_NAMES: SmsToolName[] = [
  ...SMS_ACTION_TOOL_NAMES,
  ...SMS_READ_TOOL_NAMES,
];

export const SMS_REFERENCE_PATTERN = /^S-[0-9A-Fa-f]{16}$/;
export const SMS_PHONE_TARGETS = ["airtel", "safaricom"] as const;

const SECRET_LIKE =
  /(postgresql:\/\/|jdbc:|mongodb:\/\/|-----BEGIN |Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{10,})/i;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function rejectSecretLike(value: string): void {
  if (SECRET_LIKE.test(value)) throw new ValidationError("validation");
}

const uuid = z.string().uuid();
const boundedText = (max: number) => z.string().trim().min(1).max(max);

const sendAgentSmsInput = z
  .object({
    agent_id: uuid.optional(),
    agent_business_id: boundedText(32).optional(),
    message: z
      .string()
      .min(1)
      .max(SMS_MAX_MESSAGE_LENGTH)
      .refine((v) => !CONTROL_CHARS.test(v), { message: "control characters" }),
    phone_target: z.enum(SMS_PHONE_TARGETS).default("airtel"),
    expected_agent_status: boundedText(64),
    expected_recipient_business_id: boundedText(32),
    expected_destination_fingerprint: boundedText(128),
    idempotency_key: uuid,
    explicit_action_authorized: z.literal(true),
    instruction_summary: boundedText(200),
    record_in_app: z.boolean().optional().default(true),
  })
  .strict()
  .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
    message: "agent_id or agent_business_id required",
  })
  .superRefine((v, ctx) => {
    try {
      rejectSecretLike(v.message);
    } catch {
      ctx.addIssue({ code: "custom", message: "validation" });
    }
  });

const previewInput = z
  .object({
    agent_id: uuid.optional(),
    agent_business_id: boundedText(32).optional(),
    phone_target: z.enum(SMS_PHONE_TARGETS).default("airtel"),
  })
  .strict()
  .refine((v) => Boolean(v.agent_id || v.agent_business_id), {
    message: "agent_id or agent_business_id required",
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
    sms_reference: boundedText(64).regex(SMS_REFERENCE_PATTERN, {
      message: "sms_reference must be S- followed by 16 hex characters",
    }),
    agent_id: uuid.optional(),
    agent_business_id: boundedText(32).optional(),
  })
  .strict();

export const SMS_TOOL_INPUTS = {
  send_agent_sms: sendAgentSmsInput,
  preview_agent_sms_recipient: previewInput,
  get_agent_sms_history: historyInput,
  get_sms_delivery_status: deliveryStatusInput,
} as const;

export const SMS_TOOL_SCHEMAS: Record<
  SmsToolName,
  {
    type: "object";
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
  }
> = {
  send_agent_sms: {
    type: "object",
    additionalProperties: false,
    properties: {
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
      message: { type: "string", minLength: 1, maxLength: SMS_MAX_MESSAGE_LENGTH },
      phone_target: { type: "string", enum: [...SMS_PHONE_TARGETS] },
      expected_agent_status: { type: "string", minLength: 1, maxLength: 64 },
      expected_recipient_business_id: { type: "string", minLength: 1, maxLength: 32 },
      expected_destination_fingerprint: { type: "string", minLength: 1, maxLength: 128 },
      idempotency_key: { type: "string", format: "uuid" },
      explicit_action_authorized: { type: "boolean", const: true },
      instruction_summary: { type: "string", minLength: 1, maxLength: 200 },
      record_in_app: { type: "boolean" },
    },
    required: [
      "message",
      "expected_agent_status",
      "expected_recipient_business_id",
      "expected_destination_fingerprint",
      "idempotency_key",
      "explicit_action_authorized",
      "instruction_summary",
    ],
  },
  preview_agent_sms_recipient: {
    type: "object",
    additionalProperties: false,
    properties: {
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
      phone_target: { type: "string", enum: [...SMS_PHONE_TARGETS] },
    },
    required: [],
  },
  get_agent_sms_history: {
    type: "object",
    additionalProperties: false,
    properties: {
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
      since: { type: "string", format: "date-time" },
      until: { type: "string", format: "date-time" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: [],
  },
  get_sms_delivery_status: {
    type: "object",
    additionalProperties: false,
    properties: {
      sms_reference: { type: "string", pattern: "^S-[0-9A-Fa-f]{16}$" },
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 1, maxLength: 32 },
    },
    required: ["sms_reference"],
  },
};

export const SMS_ACTION_SQL_FN: Record<SmsActionToolName, string> = {
  send_agent_sms: "prepare_send_agent_sms",
};

export const SMS_READ_TO_SQL: Record<
  SmsReadToolName,
  { fn: string; argBuilder: (a: Record<string, unknown>) => unknown[] }
> = {
  preview_agent_sms_recipient: {
    fn: "preview_agent_sms_recipient",
    argBuilder: (a) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.phone_target ?? "airtel",
    ],
  },
  get_agent_sms_history: {
    fn: "get_agent_sms_history",
    argBuilder: (a) => [
      a.agent_id ?? null,
      a.agent_business_id ?? null,
      a.since ?? null,
      a.until ?? null,
      a.limit ?? null,
    ],
  },
  get_sms_delivery_status: {
    fn: "get_sms_delivery_status",
    argBuilder: (a) => [
      a.sms_reference,
      a.agent_id ?? null,
      a.agent_business_id ?? null,
    ],
  },
};

export function fullSmsToolName(tool: SmsToolName): string {
  return `${MESSAGING_NAMESPACE}.${tool}`;
}

export function parseSmsToolName(full: string): SmsToolName | null {
  const prefix = `${MESSAGING_NAMESPACE}.`;
  if (!full.startsWith(prefix)) return null;
  const short = full.slice(prefix.length) as SmsToolName;
  return SMS_TOOL_NAMES.includes(short) ? short : null;
}

export function isSmsActionTool(tool: SmsToolName): tool is SmsActionToolName {
  return (SMS_ACTION_TOOL_NAMES as string[]).includes(tool);
}

export function parseSmsArgs(
  tool: SmsToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const schema = SMS_TOOL_INPUTS[tool];
  const parsed = schema.safeParse(args);
  if (!parsed.success) throw new ValidationError("validation");
  return parsed.data as Record<string, unknown>;
}

export function zodSmsPropertyKeys(tool: SmsToolName): string[] {
  return zodObjectKeys(SMS_TOOL_INPUTS[tool]).sort();
}

export function jsonSchemaPropertyKeys(tool: SmsToolName): string[] {
  return Object.keys(SMS_TOOL_SCHEMAS[tool].properties).sort();
}

export function jsonSchemaRequiredKeys(tool: SmsToolName): string[] {
  return [...SMS_TOOL_SCHEMAS[tool].required].sort();
}

export function jsonSchemaAllowsOnlyDeclaredKeys(
  tool: SmsToolName,
  args: Record<string, unknown>,
): boolean {
  const allowed = new Set(Object.keys(SMS_TOOL_SCHEMAS[tool].properties));
  return Object.keys(args).every((k) => allowed.has(k));
}

export function estimateSmsSegments(message: string): {
  encoding: "gsm7_estimate" | "ucs2_estimate";
  estimated_segments: number;
  message_length: number;
} {
  const message_length = message.length;
  const unicode = /[^\x00-\x7F]/.test(message);
  const encoding = unicode ? "ucs2_estimate" : "gsm7_estimate";
  const size = unicode ? 70 : 160;
  const estimated_segments =
    message_length === 0 ? 0 : Math.max(1, Math.ceil(message_length / size));
  return { encoding, estimated_segments, message_length };
}
