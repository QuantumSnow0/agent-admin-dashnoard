import { z } from "zod";
import { ValidationError, validateLimit } from "./validation.js";

export { ValidationError };

export const OPERATIONS_TOOL_INPUTS = {
  search_agents: z
    .object({
      name: z.string().min(1).max(120).optional(),
      phone: z.string().min(3).max(32).optional(),
      email: z.string().min(3).max(120).optional(),
      county: z.string().min(1).max(120).optional(),
      status: z.string().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict()
    .refine(
      (o) =>
        Boolean(
          o.name?.trim() ||
            o.phone?.trim() ||
            o.email?.trim() ||
            o.county?.trim() ||
            o.status?.trim(),
        ),
      { message: "unsupported_filter" },
    ),
  get_agent_details: z
    .object({
      agent_id: z.string().uuid().optional(),
      agent_business_id: z.string().min(2).max(20).optional(),
    })
    .strict()
    .refine((o) => Boolean(o.agent_id || o.agent_business_id?.trim()), {
      message: "unsupported_filter",
    }),
  search_leads: z
    .object({
      lead_ref: z.string().min(2).max(32).optional(),
      phone: z.string().min(3).max(32).optional(),
      email: z.string().min(3).max(120).optional(),
      name: z.string().min(1).max(120).optional(),
      county: z.string().min(1).max(120).optional(),
      status: z.string().min(1).max(40).optional(),
      product: z.enum(["airtel", "safaricom"]).optional(),
      assigned_agent_id: z.string().uuid().optional(),
      source: z.enum(["airtel5grouter", "internetkenya", "agent_own"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict()
    .refine(
      (o) =>
        Boolean(
          o.lead_ref?.trim() ||
            o.phone?.trim() ||
            o.email?.trim() ||
            o.name?.trim() ||
            o.county?.trim() ||
            o.status?.trim() ||
            o.product ||
            o.assigned_agent_id ||
            o.source,
        ),
      { message: "unsupported_filter" },
    ),
  get_lead_details: z
    .object({
      lead_id: z.string().uuid().optional(),
      lead_ref: z.string().min(2).max(32).optional(),
      primary_phone: z.string().min(3).max(32).optional(),
      national_id: z.string().min(4).max(32).optional(),
    })
    .strict()
    .refine(
      (o) =>
        Boolean(
          o.lead_id || o.lead_ref?.trim() || o.primary_phone?.trim() || o.national_id?.trim(),
        ),
      { message: "unsupported_filter" },
    ),
  search_customers: z
    .object({
      name: z.string().min(1).max(120).optional(),
      phone: z.string().min(3).max(32).optional(),
      email: z.string().min(3).max(120).optional(),
      county: z.string().min(1).max(120).optional(),
      status: z.string().min(1).max(40).optional(),
      product: z.enum(["airtel", "safaricom"]).optional(),
      assigned_agent_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict()
    .refine(
      (o) =>
        Boolean(
          o.name?.trim() ||
            o.phone?.trim() ||
            o.email?.trim() ||
            o.county?.trim() ||
            o.status?.trim() ||
            o.product ||
            o.assigned_agent_id,
        ),
      { message: "unsupported_filter" },
    ),
  get_customer_details: z
    .object({
      record_type: z.enum(["inbound_lead", "customer_registration"]).optional(),
      record_id: z.string().uuid().optional(),
      phone: z.string().min(3).max(32).optional(),
      email: z.string().min(3).max(120).optional(),
      national_id: z.string().min(4).max(32).optional(),
    })
    .strict()
    .refine(
      (o) => {
        if (o.record_id && !o.record_type) return false;
        return Boolean(
          (o.record_type && o.record_id) ||
            o.phone?.trim() ||
            o.email?.trim() ||
            o.national_id?.trim(),
        );
      },
      { message: "unsupported_filter" },
    ),
} as const;

export type OperationsToolName = keyof typeof OPERATIONS_TOOL_INPUTS;

export type JsonSchemaObject = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: string[];
};

const limitProp = {
  type: "integer",
  minimum: 1,
  maximum: 100,
  description: "Max rows (default 25, hard max 100)",
} as const;

export const OPERATIONS_TOOL_SCHEMAS: Record<OperationsToolName, JsonSchemaObject> = {
  search_agents: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120 },
      phone: { type: "string", minLength: 3, maxLength: 32 },
      email: { type: "string", minLength: 3, maxLength: 120 },
      county: { type: "string", minLength: 1, maxLength: 120 },
      status: { type: "string", minLength: 1, maxLength: 40 },
      limit: limitProp,
    },
  },
  get_agent_details: {
    type: "object",
    additionalProperties: false,
    properties: {
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 2, maxLength: 20 },
    },
  },
  search_leads: {
    type: "object",
    additionalProperties: false,
    properties: {
      lead_ref: { type: "string", minLength: 2, maxLength: 32 },
      phone: { type: "string", minLength: 3, maxLength: 32 },
      email: { type: "string", minLength: 3, maxLength: 120 },
      name: { type: "string", minLength: 1, maxLength: 120 },
      county: { type: "string", minLength: 1, maxLength: 120 },
      status: { type: "string", minLength: 1, maxLength: 40 },
      product: { type: "string", enum: ["airtel", "safaricom"] },
      assigned_agent_id: { type: "string", format: "uuid" },
      source: {
        type: "string",
        enum: ["airtel5grouter", "internetkenya", "agent_own"],
      },
      limit: limitProp,
    },
  },
  get_lead_details: {
    type: "object",
    additionalProperties: false,
    properties: {
      lead_id: { type: "string", format: "uuid" },
      lead_ref: { type: "string", minLength: 2, maxLength: 32 },
      primary_phone: { type: "string", minLength: 3, maxLength: 32 },
      national_id: { type: "string", minLength: 4, maxLength: 32 },
    },
  },
  search_customers: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120 },
      phone: { type: "string", minLength: 3, maxLength: 32 },
      email: { type: "string", minLength: 3, maxLength: 120 },
      county: { type: "string", minLength: 1, maxLength: 120 },
      status: { type: "string", minLength: 1, maxLength: 40 },
      product: { type: "string", enum: ["airtel", "safaricom"] },
      assigned_agent_id: { type: "string", format: "uuid" },
      limit: limitProp,
    },
  },
  get_customer_details: {
    type: "object",
    additionalProperties: false,
    properties: {
      record_type: {
        type: "string",
        enum: ["inbound_lead", "customer_registration"],
      },
      record_id: { type: "string", format: "uuid" },
      phone: { type: "string", minLength: 3, maxLength: 32 },
      email: { type: "string", minLength: 3, maxLength: 120 },
      national_id: { type: "string", minLength: 4, maxLength: 32 },
    },
  },
};

export const OPERATIONS_TOOL_TO_SQL: Record<
  OperationsToolName,
  { schema: string; fn: string; argBuilder: (args: Record<string, unknown>) => unknown[] }
> = {
  search_agents: {
    schema: "wam_ai",
    fn: "search_agents",
    argBuilder: (a) => [
      a.name ?? null,
      a.phone ?? null,
      a.email ?? null,
      a.county ?? null,
      a.status ?? null,
      a.limit ?? null,
    ],
  },
  get_agent_details: {
    schema: "wam_ai",
    fn: "get_agent_details",
    argBuilder: (a) => [a.agent_id ?? null, a.agent_business_id ?? null],
  },
  search_leads: {
    schema: "wam_ai",
    fn: "search_leads",
    argBuilder: (a) => [
      a.lead_ref ?? null,
      a.phone ?? null,
      a.email ?? null,
      a.name ?? null,
      a.county ?? null,
      a.status ?? null,
      a.product ?? null,
      a.assigned_agent_id ?? null,
      a.source ?? null,
      a.limit ?? null,
    ],
  },
  get_lead_details: {
    schema: "wam_ai",
    fn: "get_lead_details",
    argBuilder: (a) => [
      a.lead_id ?? null,
      a.lead_ref ?? null,
      a.primary_phone ?? null,
      a.national_id ?? null,
    ],
  },
  search_customers: {
    schema: "wam_ai",
    fn: "search_customers",
    argBuilder: (a) => [
      a.name ?? null,
      a.phone ?? null,
      a.email ?? null,
      a.county ?? null,
      a.status ?? null,
      a.product ?? null,
      a.assigned_agent_id ?? null,
      a.limit ?? null,
    ],
  },
  get_customer_details: {
    schema: "wam_ai",
    fn: "get_customer_details",
    argBuilder: (a) => [
      a.record_type ?? null,
      a.record_id ?? null,
      a.phone ?? null,
      a.email ?? null,
      a.national_id ?? null,
    ],
  },
};

export const OPERATIONS_TOOL_NAMES = Object.keys(
  OPERATIONS_TOOL_TO_SQL,
) as OperationsToolName[];

export function validateOperationsLimit(limit?: number): number | null {
  return validateLimit(limit);
}

export function parseOperationsArgs(
  tool: OperationsToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const parsed = OPERATIONS_TOOL_INPUTS[tool].parse(args) as Record<string, unknown>;
    if ("limit" in parsed) {
      validateOperationsLimit(parsed.limit as number | undefined);
    }
    return parsed;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(
      err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ZodError"
        ? "unsupported_filter"
        : "validation",
    );
  }
}
