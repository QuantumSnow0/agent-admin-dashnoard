import { z } from "zod";
import { ValidationError } from "./validation.js";
import { sqlJsonb } from "./sql-args.js";

function zodObjectKeys(schema: z.ZodTypeAny): string[] {
  if (schema instanceof z.ZodEffects) return zodObjectKeys(schema._def.schema);
  if (schema instanceof z.ZodObject) return Object.keys(schema.shape);
  return [];
}

export const INTELLIGENCE_NAMESPACE = "wam.business.intelligence";

export type IntelligenceToolName =
  | "reconcile_customer_batch"
  | "get_agent_lifecycle"
  | "get_notification_capability_catalogue";

export const INTELLIGENCE_TOOL_NAMES: IntelligenceToolName[] = [
  "reconcile_customer_batch",
  "get_agent_lifecycle",
  "get_notification_capability_catalogue",
];

const reconcileRow = z
  .object({
    row_ref: z.string().trim().min(1).max(64).optional(),
    customer_name: z.string().trim().max(120).optional(),
    airtel_phone: z.string().trim().max(32).optional(),
    safaricom_phone: z.string().trim().max(32).optional(),
    spreadsheet_installed: z.union([z.boolean(), z.string().max(32)]).optional(),
  })
  .strict();

const reconcileInput = z
  .object({
    rows: z.array(reconcileRow).max(250),
  })
  .strict();

const lifecycleInput = z
  .object({
    agent_id: z.string().uuid().optional(),
    agent_business_id: z.string().trim().min(2).max(32).optional(),
  })
  .strict()
  .refine((o) => Boolean(o.agent_id || o.agent_business_id?.trim()), {
    message: "agent_id or agent_business_id required",
  });

const catalogueInput = z.object({}).strict();

export const INTELLIGENCE_TOOL_INPUTS = {
  reconcile_customer_batch: reconcileInput,
  get_agent_lifecycle: lifecycleInput,
  get_notification_capability_catalogue: catalogueInput,
} as const;

export const INTELLIGENCE_TOOL_SCHEMAS: Record<
  IntelligenceToolName,
  {
    type: "object";
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
  }
> = {
  reconcile_customer_batch: {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        maxItems: 250,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            row_ref: { type: "string", minLength: 1, maxLength: 64 },
            customer_name: { type: "string", maxLength: 120 },
            airtel_phone: { type: "string", maxLength: 32 },
            safaricom_phone: { type: "string", maxLength: 32 },
            spreadsheet_installed: {
              oneOf: [{ type: "boolean" }, { type: "string", maxLength: 32 }],
            },
          },
        },
      },
    },
    required: ["rows"],
  },
  get_agent_lifecycle: {
    type: "object",
    additionalProperties: false,
    properties: {
      agent_id: { type: "string", format: "uuid" },
      agent_business_id: { type: "string", minLength: 2, maxLength: 32 },
    },
    required: [],
  },
  get_notification_capability_catalogue: {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: [],
  },
};

export const INTELLIGENCE_TOOL_TO_SQL: Record<
  IntelligenceToolName,
  { fn: string; argBuilder: (a: Record<string, unknown>) => unknown[] }
> = {
  reconcile_customer_batch: {
    fn: "reconcile_customer_batch",
    // JSONB: must stringify + ::jsonb — raw JS arrays cause PostgreSQL 22P02 via node-pg
    argBuilder: (a) => [sqlJsonb(a.rows ?? [])],
  },
  get_agent_lifecycle: {
    fn: "get_agent_lifecycle",
    argBuilder: (a) => [a.agent_id ?? null, a.agent_business_id ?? null],
  },
  get_notification_capability_catalogue: {
    fn: "get_notification_capability_catalogue",
    argBuilder: () => [],
  },
};

export function fullIntelligenceToolName(tool: IntelligenceToolName): string {
  return `${INTELLIGENCE_NAMESPACE}.${tool}`;
}

export function parseIntelligenceToolName(full: string): IntelligenceToolName | null {
  const prefix = `${INTELLIGENCE_NAMESPACE}.`;
  if (!full.startsWith(prefix)) return null;
  const short = full.slice(prefix.length) as IntelligenceToolName;
  return INTELLIGENCE_TOOL_NAMES.includes(short) ? short : null;
}

export function parseIntelligenceArgs(
  tool: IntelligenceToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = INTELLIGENCE_TOOL_INPUTS[tool].safeParse(args);
  if (!parsed.success) throw new ValidationError("validation");
  return parsed.data as Record<string, unknown>;
}

export function zodIntelligencePropertyKeys(tool: IntelligenceToolName): string[] {
  return zodObjectKeys(INTELLIGENCE_TOOL_INPUTS[tool]).sort();
}

export function jsonSchemaPropertyKeys(tool: IntelligenceToolName): string[] {
  return Object.keys(INTELLIGENCE_TOOL_SCHEMAS[tool].properties).sort();
}

export function jsonSchemaRequiredKeys(tool: IntelligenceToolName): string[] {
  return [...INTELLIGENCE_TOOL_SCHEMAS[tool].required].sort();
}

export function jsonSchemaAllowsOnlyDeclaredKeys(
  tool: IntelligenceToolName,
  args: Record<string, unknown>,
): boolean {
  const allowed = new Set(Object.keys(INTELLIGENCE_TOOL_SCHEMAS[tool].properties));
  return Object.keys(args).every((k) => allowed.has(k));
}

/** Audit-safe projection: never store raw phones or full row payloads. */
export function redactIntelligenceAuditArgs(
  tool: IntelligenceToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (tool !== "reconcile_customer_batch") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (/phone|email|name|national/i.test(k)) out[k] = "[REDACTED]";
      else out[k] = v;
    }
    return out;
  }
  const rows = Array.isArray(args.rows) ? args.rows : [];
  return {
    row_count: rows.length,
    rows: `[${rows.length} spreadsheet rows redacted]`,
  };
}
