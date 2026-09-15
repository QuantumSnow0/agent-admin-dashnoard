import { z } from "zod";
import { ValidationError } from "./validation.js";

function zodObjectKeys(schema: z.ZodTypeAny): string[] {
  if (schema instanceof z.ZodEffects) return zodObjectKeys(schema._def.schema);
  if (schema instanceof z.ZodObject) return Object.keys(schema.shape);
  return [];
}

export const DOCUMENTS_NAMESPACE = "wam.business.documents";

export type DocumentToolName =
  | "inspect_business_document"
  | "parse_document_customers"
  | "reconcile_document_customers";

export const DOCUMENT_TOOL_NAMES: DocumentToolName[] = [
  "inspect_business_document",
  "parse_document_customers",
  "reconcile_document_customers",
];

const mappingSchema = z
  .object({
    customer_name: z.number().int().nonnegative().optional(),
    airtel_phone: z.number().int().nonnegative().optional(),
    safaricom_phone: z.number().int().nonnegative().optional(),
    spreadsheet_installed: z.number().int().nonnegative().optional(),
  })
  .strict()
  .optional();

/** Explicit binding / reuse controls — never invent attachment_path. */
const bindingFields = {
  /** Telegram/OpenClaw peer ref when available (optional binding aid). */
  peer_ref: z.string().trim().max(128).optional(),
  /** True only when caller explicitly opts into fingerprint short-circuit for this path. */
  allow_prior_fingerprint_reuse: z.boolean().optional(),
  /** /new or session reset — clears prior fingerprint cache for this actor. */
  session_reset: z.boolean().optional(),
};

const inspectInput = z
  .object({
    attachment_path: z.string().trim().min(3).max(1024),
    ...bindingFields,
  })
  .strict();

const parseInput = z
  .object({
    attachment_path: z.string().trim().min(3).max(1024),
    sheet_index: z.number().int().nonnegative().optional(),
    sheet_name: z.string().trim().max(120).optional(),
    mapping: mappingSchema,
    installed_only: z.boolean().optional(),
    ...bindingFields,
  })
  .strict();

const reconcileInput = z
  .object({
    attachment_path: z.string().trim().min(3).max(1024),
    sheet_index: z.number().int().nonnegative().optional(),
    sheet_name: z.string().trim().max(120).optional(),
    mapping: mappingSchema,
    installed_only: z.boolean().optional(),
    idempotency_key: z.string().uuid().optional(),
    response_mode: z.enum(["full", "number_only"]).optional(),
    ...bindingFields,
  })
  .strict();

export const DOCUMENT_TOOL_INPUTS = {
  inspect_business_document: inspectInput,
  parse_document_customers: parseInput,
  reconcile_document_customers: reconcileInput,
} as const;

const bindingSchemaProps = {
  peer_ref: { type: "string", maxLength: 128 },
  allow_prior_fingerprint_reuse: { type: "boolean" },
  session_reset: { type: "boolean" },
};

export const DOCUMENT_TOOL_SCHEMAS: Record<
  DocumentToolName,
  {
    type: "object";
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
  }
> = {
  inspect_business_document: {
    type: "object",
    additionalProperties: false,
    properties: {
      attachment_path: { type: "string", minLength: 3, maxLength: 1024 },
      ...bindingSchemaProps,
    },
    required: ["attachment_path"],
  },
  parse_document_customers: {
    type: "object",
    additionalProperties: false,
    properties: {
      attachment_path: { type: "string", minLength: 3, maxLength: 1024 },
      sheet_index: { type: "integer", minimum: 0 },
      sheet_name: { type: "string", maxLength: 120 },
      mapping: {
        type: "object",
        additionalProperties: false,
        properties: {
          customer_name: { type: "integer", minimum: 0 },
          airtel_phone: { type: "integer", minimum: 0 },
          safaricom_phone: { type: "integer", minimum: 0 },
          spreadsheet_installed: { type: "integer", minimum: 0 },
        },
      },
      installed_only: { type: "boolean" },
      ...bindingSchemaProps,
    },
    required: ["attachment_path"],
  },
  reconcile_document_customers: {
    type: "object",
    additionalProperties: false,
    properties: {
      attachment_path: { type: "string", minLength: 3, maxLength: 1024 },
      sheet_index: { type: "integer", minimum: 0 },
      sheet_name: { type: "string", maxLength: 120 },
      mapping: {
        type: "object",
        additionalProperties: false,
        properties: {
          customer_name: { type: "integer", minimum: 0 },
          airtel_phone: { type: "integer", minimum: 0 },
          safaricom_phone: { type: "integer", minimum: 0 },
          spreadsheet_installed: { type: "integer", minimum: 0 },
        },
      },
      installed_only: { type: "boolean" },
      idempotency_key: { type: "string", format: "uuid" },
      response_mode: { type: "string", enum: ["full", "number_only"] },
      ...bindingSchemaProps,
    },
    required: ["attachment_path"],
  },
};

export function fullDocumentToolName(tool: DocumentToolName): string {
  return `${DOCUMENTS_NAMESPACE}.${tool}`;
}

export function parseDocumentToolName(full: string): DocumentToolName | null {
  const prefix = `${DOCUMENTS_NAMESPACE}.`;
  if (!full.startsWith(prefix)) return null;
  const short = full.slice(prefix.length) as DocumentToolName;
  return DOCUMENT_TOOL_NAMES.includes(short) ? short : null;
}

export function parseDocumentArgs(
  tool: DocumentToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = DOCUMENT_TOOL_INPUTS[tool].safeParse(args);
  if (!parsed.success) throw new ValidationError("validation");
  return parsed.data as Record<string, unknown>;
}

export function redactDocumentAuditArgs(
  tool: DocumentToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return {
    tool,
    attachment_path: "[REDACTED_PATH]",
    has_mapping: Boolean(args.mapping),
    sheet_index: args.sheet_index ?? null,
    sheet_name_present: Boolean(args.sheet_name),
    installed_only: Boolean(args.installed_only),
    response_mode: args.response_mode ?? "full",
    idempotency_key_present: Boolean(args.idempotency_key),
    allow_prior_fingerprint_reuse: Boolean(args.allow_prior_fingerprint_reuse),
    session_reset: Boolean(args.session_reset),
    peer_ref_present: Boolean(args.peer_ref),
  };
}

export function zodDocumentPropertyKeys(tool: DocumentToolName): string[] {
  return zodObjectKeys(DOCUMENT_TOOL_INPUTS[tool]).sort();
}
