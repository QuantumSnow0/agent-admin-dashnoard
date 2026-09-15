/**
 * Phase 1A.9 — structured business query validation (Zod + catalogue allowlists).
 * MCP accepts structured JSON only; natural language is interpreted by the model.
 */

import { z } from "zod";
import { ValidationError } from "./validation.js";
import { sqlJsonb } from "./sql-args.js";
import {
  AGGREGATE_FNS,
  DEFAULT_LIST_LIMIT,
  FILTER_OPS,
  MAX_FILTERS,
  MAX_GROUP_BY,
  MAX_LIST_LIMIT,
  MAX_METRICS,
  MAX_SORT,
  QUERY_DATASETS,
  QUERY_NAMESPACE,
  RESPONSE_MODES,
  detectClarification,
  getDataset,
  resolveField,
  type QueryDataset,
} from "./query-catalogue.js";
import { isRelativePeriod } from "./query-dates.js";

export { QUERY_NAMESPACE };

export type QueryToolName =
  | "describe_business_query_catalogue"
  | "list_business_records"
  | "aggregate_business_metrics";

export const QUERY_TOOL_NAMES: QueryToolName[] = [
  "describe_business_query_catalogue",
  "list_business_records",
  "aggregate_business_metrics",
];

const FORBIDDEN_ARG_KEYS = new Set([
  "sql",
  "query",
  "rawSql",
  "raw_sql",
  "statement",
  "select_sql",
  "table",
  "from",
  "join_sql",
]);

function zodObjectKeys(schema: z.ZodTypeAny): string[] {
  if (schema instanceof z.ZodEffects) return zodObjectKeys(schema._def.schema);
  if (schema instanceof z.ZodObject) return Object.keys(schema.shape);
  return [];
}

const fieldId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "field must be snake_case identifier");

const filterSchema = z
  .object({
    field: fieldId,
    op: z.enum(FILTER_OPS as unknown as [string, ...string[]]),
    value: z.unknown().optional(),
  })
  .strict();

const sortSchema = z
  .object({
    field: fieldId,
    dir: z.enum(["asc", "desc"]).default("asc"),
  })
  .strict();

const metricSchema = z
  .object({
    fn: z.enum(AGGREGATE_FNS as unknown as [string, ...string[]]),
    field: fieldId.default("id"),
    alias: z
      .string()
      .trim()
      .min(1)
      .max(48)
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
  })
  .strict();

const catalogueInput = z
  .object({
    dataset: z.enum(QUERY_DATASETS as unknown as [string, ...string[]]).optional(),
    intent: z.string().trim().max(64).optional(),
  })
  .strict();

const listInput = z
  .object({
    dataset: z.enum(QUERY_DATASETS as unknown as [string, ...string[]]).optional(),
    intent: z.string().trim().max(64).optional(),
    select: z.array(fieldId).max(24).optional(),
    filters: z.array(filterSchema).max(MAX_FILTERS).optional(),
    sort: z.array(sortSchema).max(MAX_SORT).optional(),
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
    response_mode: z.enum(RESPONSE_MODES as unknown as [string, ...string[]]).optional(),
    joins: z.array(z.never()).max(0).optional(),
  })
  .strict();

const aggregateInput = z
  .object({
    dataset: z.enum(QUERY_DATASETS as unknown as [string, ...string[]]).optional(),
    intent: z.string().trim().max(64).optional(),
    metrics: z.array(metricSchema).min(1).max(MAX_METRICS),
    filters: z.array(filterSchema).max(MAX_FILTERS).optional(),
    group_by: z.array(fieldId).max(MAX_GROUP_BY).optional(),
    sort: z.array(sortSchema).max(MAX_SORT).optional(),
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
    response_mode: z.enum(RESPONSE_MODES as unknown as [string, ...string[]]).optional(),
    joins: z.array(z.never()).max(0).optional(),
  })
  .strict();

export const QUERY_TOOL_INPUTS = {
  describe_business_query_catalogue: catalogueInput,
  list_business_records: listInput,
  aggregate_business_metrics: aggregateInput,
} as const;

export const QUERY_TOOL_SCHEMAS: Record<
  QueryToolName,
  {
    type: "object";
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
  }
> = {
  describe_business_query_catalogue: {
    type: "object",
    additionalProperties: false,
    properties: {
      dataset: { type: "string", enum: [...QUERY_DATASETS] },
      intent: { type: "string", maxLength: 64 },
    },
    required: [],
  },
  list_business_records: {
    type: "object",
    additionalProperties: false,
    properties: {
      dataset: { type: "string", enum: [...QUERY_DATASETS] },
      intent: { type: "string", maxLength: 64 },
      select: { type: "array", maxItems: 24, items: { type: "string" } },
      filters: {
        type: "array",
        maxItems: MAX_FILTERS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string" },
            op: { type: "string", enum: [...FILTER_OPS] },
            value: {},
          },
          required: ["field", "op"],
        },
      },
      sort: {
        type: "array",
        maxItems: MAX_SORT,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string" },
            dir: { type: "string", enum: ["asc", "desc"] },
          },
          required: ["field"],
        },
      },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
      offset: { type: "integer", minimum: 0, maximum: 10000 },
      response_mode: { type: "string", enum: [...RESPONSE_MODES] },
      joins: { type: "array", maxItems: 0, items: { type: "string" } },
    },
    required: [],
  },
  aggregate_business_metrics: {
    type: "object",
    additionalProperties: false,
    properties: {
      dataset: { type: "string", enum: [...QUERY_DATASETS] },
      intent: { type: "string", maxLength: 64 },
      metrics: {
        type: "array",
        minItems: 1,
        maxItems: MAX_METRICS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            fn: { type: "string", enum: [...AGGREGATE_FNS] },
            field: { type: "string" },
            alias: { type: "string" },
          },
          required: ["fn"],
        },
      },
      filters: {
        type: "array",
        maxItems: MAX_FILTERS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string" },
            op: { type: "string", enum: [...FILTER_OPS] },
            value: {},
          },
          required: ["field", "op"],
        },
      },
      group_by: { type: "array", maxItems: MAX_GROUP_BY, items: { type: "string" } },
      sort: {
        type: "array",
        maxItems: MAX_SORT,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string" },
            dir: { type: "string", enum: ["asc", "desc"] },
          },
          required: ["field"],
        },
      },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
      response_mode: { type: "string", enum: [...RESPONSE_MODES] },
      joins: { type: "array", maxItems: 0, items: { type: "string" } },
    },
    required: ["metrics"],
  },
};

function assertNoForbiddenKeys(args: Record<string, unknown>): void {
  for (const k of Object.keys(args)) {
    if (FORBIDDEN_ARG_KEYS.has(k) || /sql|select\s|union|drop|insert|update|delete/i.test(k)) {
      throw new ValidationError("validation");
    }
  }
}

function validateFilterValue(op: string, value: unknown, fieldType: string): void {
  if (op === "is_null" || op === "is_not_null") {
    if (value !== undefined && value !== null) throw new ValidationError("validation");
    return;
  }
  if (value === undefined || value === null) throw new ValidationError("validation");

  if (op === "relative_range") {
    if (!isRelativePeriod(value)) throw new ValidationError("validation");
    return;
  }
  if (op === "date_trunc_eq") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (value as { grain?: string }).grain !== "month" ||
      (value as { ref?: string }).ref !== "current"
    ) {
      throw new ValidationError("validation");
    }
    return;
  }
  if (op === "between") {
    if (!Array.isArray(value) || value.length !== 2) throw new ValidationError("validation");
    return;
  }
  if (op === "in" || op === "not_in") {
    if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
      throw new ValidationError("validation");
    }
    return;
  }
  if (op === "ilike_prefix") {
    if (typeof value !== "string" || value.length < 1 || value.length > 80) {
      throw new ValidationError("validation");
    }
    if (/[%_]/.test(value)) throw new ValidationError("validation");
    return;
  }
  if (op === "eq_calendar_date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ValidationError("validation");
    }
    return;
  }
  // scalar comparisons
  if (typeof value === "string" && value.length > 200) throw new ValidationError("validation");
  if (fieldType === "timestamptz" && typeof value === "string" && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new ValidationError("validation");
  }
}

function validateAgainstCatalogue(
  tool: QueryToolName,
  parsed: Record<string, unknown>,
): void {
  if (tool === "describe_business_query_catalogue") return;

  const datasetId = parsed.dataset as string | undefined;
  if (!datasetId) return; // clarification path
  const ds = getDataset(datasetId);
  if (!ds) throw new ValidationError("validation");

  const filters = (parsed.filters as Array<{ field: string; op: string; value?: unknown }>) ?? [];
  for (const f of filters) {
    const field = resolveField(ds, f.field);
    if (!field || !field.filterable) throw new ValidationError("validation");
    // Reject alias keys that resolve to a different semantic — require canonical field id in filters
    if (field.id !== f.field && !(field.aliases ?? []).includes(f.field)) {
      throw new ValidationError("validation");
    }
    // Normalize: allow alias only if it maps to this field; store canonical in SQL via remap later
    validateFilterValue(f.op, f.value, field.type);
    if (
      (f.op === "relative_range" || f.op === "date_trunc_eq" || f.op === "eq_calendar_date") &&
      field.type !== "timestamptz" &&
      field.type !== "date" &&
      field.type !== "date_text_mdy"
    ) {
      throw new ValidationError("validation");
    }
  }

  if (tool === "list_business_records") {
    const select = (parsed.select as string[] | undefined) ?? [];
    for (const s of select) {
      const field = resolveField(ds, s);
      if (!field || !field.selectable) throw new ValidationError("validation");
    }
    const sort = (parsed.sort as Array<{ field: string }> | undefined) ?? [];
    for (const s of sort) {
      const field = resolveField(ds, s.field);
      if (!field || !field.sortable) throw new ValidationError("validation");
    }
  }

  if (tool === "aggregate_business_metrics") {
    const metrics = (parsed.metrics as Array<{ fn: string; field?: string }>) ?? [];
    for (const m of metrics) {
      const fid = m.field ?? "id";
      const field = resolveField(ds, fid);
      if (!field || !field.aggregateTarget) throw new ValidationError("validation");
      if ((m.fn === "min" || m.fn === "max") && field.type !== "timestamptz" && field.type !== "date") {
        throw new ValidationError("validation");
      }
    }
    const groupBy = (parsed.group_by as string[] | undefined) ?? [];
    for (const g of groupBy) {
      const field = resolveField(ds, g);
      if (!field || !field.groupable) throw new ValidationError("validation");
    }
    const sort = (parsed.sort as Array<{ field: string }> | undefined) ?? [];
    for (const s of sort) {
      // allow sorting by group_by field or metric alias
      const field = resolveField(ds, s.field);
      const isMetricAlias = metrics.some(
        (m, i) => (m as { alias?: string }).alias === s.field || `m${i}` === s.field,
      );
      if (!field?.groupable && !isMetricAlias) throw new ValidationError("validation");
    }
  }
}

/** Remap filter/select/sort field aliases to canonical catalogue ids before SQL. */
export function canonicalizeQueryArgs(
  dataset: QueryDataset,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const ds = getDataset(dataset)!;
  const mapField = (fid: string) => resolveField(ds, fid)?.id ?? fid;

  const out: Record<string, unknown> = { ...args, dataset };
  if (Array.isArray(args.select)) {
    out.select = (args.select as string[]).map(mapField);
  }
  if (Array.isArray(args.filters)) {
    out.filters = (args.filters as Array<Record<string, unknown>>).map((f) => ({
      ...f,
      field: mapField(String(f.field)),
    }));
  }
  if (Array.isArray(args.group_by)) {
    out.group_by = (args.group_by as string[]).map(mapField);
  }
  if (Array.isArray(args.sort)) {
    out.sort = (args.sort as Array<Record<string, unknown>>).map((s) => ({
      ...s,
      field: mapField(String(s.field)),
    }));
  }
  if (Array.isArray(args.metrics)) {
    out.metrics = (args.metrics as Array<Record<string, unknown>>).map((m) => ({
      ...m,
      field: mapField(String(m.field ?? "id")),
    }));
  }
  return out;
}

export function fullQueryToolName(tool: QueryToolName): string {
  return `${QUERY_NAMESPACE}.${tool}`;
}

export function parseQueryToolName(full: string): QueryToolName | null {
  const prefix = `${QUERY_NAMESPACE}.`;
  if (!full.startsWith(prefix)) return null;
  const short = full.slice(prefix.length) as QueryToolName;
  return QUERY_TOOL_NAMES.includes(short) ? short : null;
}

export function parseQueryArgs(
  tool: QueryToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  assertNoForbiddenKeys(args);
  const parsed = QUERY_TOOL_INPUTS[tool].safeParse(args);
  if (!parsed.success) throw new ValidationError("validation");
  const data = parsed.data as Record<string, unknown>;
  validateAgainstCatalogue(tool, data);
  if (typeof data.dataset === "string") {
    return canonicalizeQueryArgs(data.dataset as QueryDataset, data);
  }
  return data;
}

export function tryClarification(
  tool: QueryToolName,
  args: Record<string, unknown>,
): Record<string, unknown> | null {
  return detectClarification(tool, args);
}

export const QUERY_TOOL_TO_SQL: Record<
  QueryToolName,
  { fn: string | null; argBuilder: (a: Record<string, unknown>) => unknown[] }
> = {
  describe_business_query_catalogue: {
    fn: null, // served from TypeScript catalogue (SQL mirror also available)
    argBuilder: () => [],
  },
  list_business_records: {
    fn: "list_business_records",
    argBuilder: (a) => [
      sqlJsonb({
        dataset: a.dataset,
        select: a.select ?? null,
        filters: a.filters ?? [],
        sort: a.sort ?? null,
        limit: a.limit ?? DEFAULT_LIST_LIMIT,
        offset: a.offset ?? 0,
        response_mode: a.response_mode ?? "summary",
      }),
    ],
  },
  aggregate_business_metrics: {
    fn: "aggregate_business_metrics",
    argBuilder: (a) => [
      sqlJsonb({
        dataset: a.dataset,
        metrics: a.metrics,
        filters: a.filters ?? [],
        group_by: a.group_by ?? [],
        sort: a.sort ?? null,
        limit: a.limit ?? MAX_LIST_LIMIT,
        response_mode: a.response_mode ?? "summary",
      }),
    ],
  },
};

/** Audit: shape only — never store filter values, phones, names, or row payloads. */
export function redactQueryAuditArgs(
  tool: QueryToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const filters = Array.isArray(args.filters) ? args.filters : [];
  const metrics = Array.isArray(args.metrics) ? args.metrics : [];
  return {
    tool,
    dataset: args.dataset ?? null,
    intent: args.intent ?? null,
    response_mode: args.response_mode ?? null,
    filter_count: filters.length,
    filter_fields: filters.map((f: { field?: string; op?: string }) => ({
      field: f.field ?? null,
      op: f.op ?? null,
    })),
    select_fields: Array.isArray(args.select) ? args.select : null,
    group_by: Array.isArray(args.group_by) ? args.group_by : null,
    sort_fields: Array.isArray(args.sort)
      ? (args.sort as Array<{ field?: string; dir?: string }>).map((s) => ({
          field: s.field ?? null,
          dir: s.dir ?? null,
        }))
      : null,
    metrics: metrics.map((m: { fn?: string; field?: string; alias?: string }) => ({
      fn: m.fn ?? null,
      field: m.field ?? null,
      alias: m.alias ?? null,
    })),
    limit: args.limit ?? null,
    offset: args.offset ?? null,
  };
}

export function zodQueryPropertyKeys(tool: QueryToolName): string[] {
  return zodObjectKeys(QUERY_TOOL_INPUTS[tool]).sort();
}

export function jsonSchemaPropertyKeys(tool: QueryToolName): string[] {
  return Object.keys(QUERY_TOOL_SCHEMAS[tool].properties).sort();
}

export function jsonSchemaAllowsOnlyDeclaredKeys(
  tool: QueryToolName,
  args: Record<string, unknown>,
): boolean {
  const allowed = new Set(Object.keys(QUERY_TOOL_SCHEMAS[tool].properties));
  return Object.keys(args).every((k) => allowed.has(k));
}
