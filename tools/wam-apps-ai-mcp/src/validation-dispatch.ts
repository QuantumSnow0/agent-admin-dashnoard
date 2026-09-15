import { z } from "zod";
import { ValidationError } from "./validation.js";

export { ValidationError };

export const DISPATCH_TOOL_INPUTS = {
  recommend_agents_for_lead: z
    .object({
      lead_id: z.string().uuid().optional(),
      lead_ref: z.string().min(2).max(32).optional(),
      limit: z.number().int().min(1).max(25).optional(),
      include_unavailable: z.boolean().optional(),
      include_ineligible_diagnostics: z.boolean().optional(),
      performance_window_days: z.number().int().min(7).max(90).optional(),
    })
    .strict()
    .refine((o) => Boolean(o.lead_id || o.lead_ref?.trim()), {
      message: "unsupported_filter",
    }),
} as const;

export type DispatchToolName = keyof typeof DISPATCH_TOOL_INPUTS;

export type JsonSchemaObject = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: string[];
};

export const DISPATCH_TOOL_SCHEMAS: Record<DispatchToolName, JsonSchemaObject> = {
  recommend_agents_for_lead: {
    type: "object",
    additionalProperties: false,
    properties: {
      lead_id: { type: "string", format: "uuid" },
      lead_ref: { type: "string", minLength: 2, maxLength: 32 },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 25,
        description: "Max candidates returned (default 10, hard max 25)",
      },
      include_unavailable: {
        type: "boolean",
        description: "Include unavailable agents as hard-ineligible diagnostics when combined with include_ineligible_diagnostics",
      },
      include_ineligible_diagnostics: {
        type: "boolean",
        description: "Return hard-ineligible agents in ineligible_diagnostics",
      },
      performance_window_days: {
        type: "integer",
        minimum: 7,
        maximum: 90,
        description: "Recent performance window (default 30 days)",
      },
    },
  },
};

export const DISPATCH_TOOL_TO_SQL: Record<
  DispatchToolName,
  { schema: string; fn: string; argBuilder: (args: Record<string, unknown>) => unknown[] }
> = {
  recommend_agents_for_lead: {
    schema: "wam_ai",
    fn: "recommend_agents_for_lead",
    argBuilder: (a) => [
      a.lead_id ?? null,
      a.lead_ref ?? null,
      a.limit ?? null,
      a.include_unavailable ?? false,
      a.include_ineligible_diagnostics ?? false,
      a.performance_window_days ?? null,
    ],
  },
};

export const DISPATCH_TOOL_NAMES = Object.keys(
  DISPATCH_TOOL_TO_SQL,
) as DispatchToolName[];

export function validateRecommendLimit(limit?: number): number | null {
  if (limit === undefined || limit === null) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new ValidationError("unsupported_filter");
  }
  return limit;
}

export function parseDispatchArgs(
  tool: DispatchToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const parsed = DISPATCH_TOOL_INPUTS[tool].parse(args) as Record<string, unknown>;
    if ("limit" in parsed && parsed.limit !== undefined) {
      validateRecommendLimit(parsed.limit as number);
    }
    if ("performance_window_days" in parsed && parsed.performance_window_days !== undefined) {
      const d = parsed.performance_window_days as number;
      if (!Number.isInteger(d) || d < 7 || d > 90) {
        throw new ValidationError("unsupported_filter");
      }
    }
    return parsed;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(
      err &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name: string }).name === "ZodError"
        ? "unsupported_filter"
        : "validation",
    );
  }
}
