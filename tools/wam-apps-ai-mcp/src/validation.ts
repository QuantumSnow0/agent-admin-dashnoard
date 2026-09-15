import { z } from "zod";

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/));

export const rangeSchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict();

export const limitSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export function parseOptionalDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError("invalid_date");
  }
  return d;
}

export class ValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ValidationError";
  }
}

export function validateRange(from?: string, to?: string): {
  from: Date | null;
  to: Date | null;
} {
  const f = parseOptionalDate(from);
  const t = parseOptionalDate(to);
  if (f && t && f.getTime() > t.getTime()) {
    throw new ValidationError("invalid_date_range");
  }
  // Enforce max 90-day aggregate range (DB also clamps as defense in depth)
  if (f && t) {
    const days = (t.getTime() - f.getTime()) / (86400 * 1000);
    if (days > 90) {
      throw new ValidationError("range_too_large");
    }
  }
  return { from: f, to: t };
}

/** Required from/to for owner/partner registration performance reporting. */
export function validateRequiredRange(from?: string, to?: string): {
  from: Date;
  to: Date;
} {
  if (!from || !to) {
    throw new ValidationError("unsupported_filter");
  }
  const { from: f, to: t } = validateRange(from, to);
  if (!f || !t) {
    throw new ValidationError("invalid_date");
  }
  return { from: f, to: t };
}

export function validateLimit(limit?: number): number | null {
  if (limit === undefined || limit === null) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError("invalid_limit");
  }
  return limit;
}

export const productSchema = z.enum(["airtel", "safaricom"]).optional();
export const sourceSchema = z
  .enum(["airtel5grouter", "internetkenya", "agent_own"])
  .optional();
export const grainSchema = z.enum(["day", "week"]).optional();

export const TOOL_INPUTS = {
  get_operational_summary: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      product: productSchema,
    })
    .strict(),
  get_agent_performance_summary: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  get_inbound_lead_funnel: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      source: sourceSchema,
    })
    .strict(),
  get_unassigned_leads: z
    .object({
      limit: z.number().int().min(1).max(100).optional(),
      product: productSchema,
      county: z.string().min(1).max(120).optional(),
    })
    .strict(),
  get_overdue_or_stalled_leads: z
    .object({
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  get_registration_install_trends: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      grain: grainSchema,
    })
    .strict(),
  get_county_location_demand: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  get_commission_payment_summary: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
    })
    .strict(),
  find_likely_duplicates_or_incomplete: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  get_operational_exceptions: z
    .object({
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  get_agent_registration_performance: z
    .object({
      from: isoDate,
      to: isoDate,
      product: productSchema,
      agent_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;

/** JSON Schema objects advertised to MCP clients — exact props per tool. */
export type JsonSchemaObject = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: string[];
};

const isoProp = {
  type: "string",
  description: "ISO-8601 timestamp or YYYY-MM-DD (optional)",
} as const;

const limitProp = {
  type: "integer",
  minimum: 1,
  maximum: 100,
  description: "Max rows to return (1–100)",
} as const;

const productProp = {
  type: "string",
  enum: ["airtel", "safaricom"],
  description: "Product filter",
} as const;

const sourceProp = {
  type: "string",
  enum: ["airtel5grouter", "internetkenya", "agent_own"],
  description: "Lead source filter",
} as const;

const grainProp = {
  type: "string",
  enum: ["day", "week"],
  description: "Trend grain",
} as const;

const countyProp = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  description: "County filter",
} as const;

export const TOOL_SCHEMAS: Record<ToolName, JsonSchemaObject> = {
  get_operational_summary: {
    type: "object",
    additionalProperties: false,
    properties: {
      from: isoProp,
      to: isoProp,
      product: productProp,
    },
  },
  get_agent_performance_summary: {
    type: "object",
    additionalProperties: false,
    properties: {
      from: isoProp,
      to: isoProp,
      limit: limitProp,
    },
  },
  get_inbound_lead_funnel: {
    type: "object",
    additionalProperties: false,
    properties: {
      from: isoProp,
      to: isoProp,
      source: sourceProp,
    },
  },
  get_unassigned_leads: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: limitProp,
      product: productProp,
      county: countyProp,
    },
  },
  get_overdue_or_stalled_leads: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: limitProp,
    },
  },
  get_registration_install_trends: {
    type: "object",
    additionalProperties: false,
    properties: {
      from: isoProp,
      to: isoProp,
      grain: grainProp,
    },
  },
  get_county_location_demand: {
    type: "object",
    additionalProperties: false,
    properties: {
      from: isoProp,
      to: isoProp,
      limit: limitProp,
    },
  },
  get_commission_payment_summary: {
    type: "object",
    additionalProperties: false,
    properties: {
      from: isoProp,
      to: isoProp,
    },
  },
  find_likely_duplicates_or_incomplete: {
    type: "object",
    additionalProperties: false,
    properties: {
      from: isoProp,
      to: isoProp,
      limit: limitProp,
    },
  },
  get_operational_exceptions: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: limitProp,
    },
  },
  get_agent_registration_performance: {
    type: "object",
    additionalProperties: false,
    required: ["from", "to"],
    properties: {
      from: { ...isoProp, description: "Range start (required ISO-8601 UTC instant)" },
      to: { ...isoProp, description: "Range end (required ISO-8601 UTC instant)" },
      product: productProp,
      agent_id: { type: "string", format: "uuid", description: "Optional single-agent filter" },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Max agents to return (default 25, max 100)",
      },
    },
  },
};

export const TOOL_TO_SQL: Record<
  ToolName,
  { schema: string; fn: string; argBuilder: (args: Record<string, unknown>) => unknown[] }
> = {
  get_operational_summary: {
    schema: "wam_ai",
    fn: "get_operational_summary",
    argBuilder: (a) => [a.from ?? null, a.to ?? null, a.product ?? null],
  },
  get_agent_performance_summary: {
    schema: "wam_ai",
    fn: "get_agent_performance_summary",
    argBuilder: (a) => [a.from ?? null, a.to ?? null, a.limit ?? null],
  },
  get_inbound_lead_funnel: {
    schema: "wam_ai",
    fn: "get_inbound_lead_funnel",
    argBuilder: (a) => [a.from ?? null, a.to ?? null, a.source ?? null],
  },
  get_unassigned_leads: {
    schema: "wam_ai",
    fn: "get_unassigned_leads",
    argBuilder: (a) => [a.limit ?? null, a.product ?? null, a.county ?? null],
  },
  get_overdue_or_stalled_leads: {
    schema: "wam_ai",
    fn: "get_overdue_or_stalled_leads",
    argBuilder: (a) => [a.limit ?? null],
  },
  get_registration_install_trends: {
    schema: "wam_ai",
    fn: "get_registration_install_trends",
    argBuilder: (a) => [a.from ?? null, a.to ?? null, a.grain ?? "day"],
  },
  get_county_location_demand: {
    schema: "wam_ai",
    fn: "get_county_location_demand",
    argBuilder: (a) => [a.from ?? null, a.to ?? null, a.limit ?? null],
  },
  get_commission_payment_summary: {
    schema: "wam_ai",
    fn: "get_commission_payment_summary",
    argBuilder: (a) => [a.from ?? null, a.to ?? null],
  },
  find_likely_duplicates_or_incomplete: {
    schema: "wam_ai",
    fn: "find_likely_duplicates_or_incomplete",
    argBuilder: (a) => [a.from ?? null, a.to ?? null, a.limit ?? null],
  },
  get_operational_exceptions: {
    schema: "wam_ai",
    fn: "get_operational_exceptions",
    argBuilder: (a) => [a.limit ?? null],
  },
  get_agent_registration_performance: {
    schema: "wam_ai",
    fn: "get_agent_registration_performance",
    argBuilder: (a) => [
      a.from ?? null,
      a.to ?? null,
      a.product ?? null,
      a.agent_id ?? null,
      a.limit ?? null,
    ],
  },
};

export const BUSINESS_TOOL_NAMES = Object.keys(TOOL_TO_SQL) as ToolName[];

export const FORBIDDEN_TOOL_NAMESPACES = [
  "wam.technical",
  "wam.security",
  "sql",
  "query",
] as const;

export const STALL_CODES = [
  "DISPATCH_BACKLOG",
  "STUCK_OFFER",
  "AGENT_FOLLOWUP_OVERDUE",
  "KYC_STALLED",
  "INSTALLATION_FOLLOWUP_REQUIRED",
  "ADMIN_INSTALL_REVIEW_BACKLOG",
  "DEFERRED_CALLBACK_OVERDUE",
] as const;
