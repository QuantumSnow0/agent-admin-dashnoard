/** Keys that must never appear in any MCP output (secrets / technical controls). */

const FORBIDDEN_OUTPUT_KEYS =

  /^(password|otp|secret|token|api_key|service_role|refresh_token|access_token|session|dedupe_phone_key|source_external_id|preview_payload|kill_switch|is_super_admin|is_admin|metadata|ms_forms_response_id|device_token|vault_|auth_|credential|pause_|bypass)/i;



export type OperationsToolName =

  | "search_agents"

  | "get_agent_details"

  | "search_customers"

  | "get_customer_details"

  | "search_leads"

  | "get_lead_details";



export type DispatchToolName = "recommend_agents_for_lead";



/** Dispatch outputs must not expose customer PII or technical secrets. */

const DISPATCH_FORBIDDEN = new Set([

  "customer_name",

  "phone",

  "primary_phone",

  "alternate_phone",

  "airtel_phone",

  "safaricom_phone",

  "email",

  "national_id",

  "dedupe_phone_key",

  "metadata",

  "preview_payload",

]);



export function assertDispatchOutputAllowed(

  tool: DispatchToolName,

  value: unknown,

  path = "$",

): string[] {

  const hits: string[] = [];

  if (Array.isArray(value)) {

    value.forEach((v, i) => hits.push(...assertDispatchOutputAllowed(tool, v, `${path}[${i}]`)));

    return hits;

  }

  if (!value || typeof value !== "object") return hits;



  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {

    if (FORBIDDEN_OUTPUT_KEYS.test(k)) {

      hits.push(`${path}.${k}`);

    }

    if (DISPATCH_FORBIDDEN.has(k)) {

      hits.push(`${path}.${k}`);

    }

    hits.push(...assertDispatchOutputAllowed(tool, v, `${path}.${k}`));

  }

  return hits;

}



/** Search/list tools must not return these identifiers. Detail tools may return SR/IMEI. */

const SEARCH_FORBIDDEN = new Set([

  "national_id",

  "airtel_sr_number",

  "safaricom_imei",

]);



export function assertOpenBookOutputAllowed(

  tool: OperationsToolName,

  value: unknown,

  path = "$",

): string[] {

  const hits: string[] = [];

  const isSearch = tool.startsWith("search_");



  if (Array.isArray(value)) {

    value.forEach((v, i) => hits.push(...assertOpenBookOutputAllowed(tool, v, `${path}[${i}]`)));

    return hits;

  }

  if (!value || typeof value !== "object") return hits;



  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {

    if (FORBIDDEN_OUTPUT_KEYS.test(k)) {

      hits.push(`${path}.${k}`);

    }

    if (isSearch && SEARCH_FORBIDDEN.has(k)) {

      hits.push(`${path}.${k}`);

    }

    hits.push(...assertOpenBookOutputAllowed(tool, v, `${path}.${k}`));

  }

  return hits;

}



export function containsHighlySensitive(value: unknown): boolean {

  if (Array.isArray(value)) {

    return value.some(containsHighlySensitive);

  }

  if (!value || typeof value !== "object") return false;

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {

    if (k === "national_id" && v != null && String(v).trim() !== "") return true;

    if (containsHighlySensitive(v)) return true;

  }

  return false;

}



/** Keys that must never appear in audit param_redacted payloads. */

export const AUDIT_REDACT_KEY =

  /(phone|email|password|secret|token|national|imei|sr_number|otp|authorization|cookie|database_url|connection|name|lead_id|lead_ref|business_ref|record_id|primary_phone|alternate_phone|customer_name|agent_business_id)/i;



export function redactAuditParams(input: Record<string, unknown>): Record<string, unknown> {

  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(input)) {

    if (AUDIT_REDACT_KEY.test(k)) {

      out[k] = "[REDACTED]";

    } else if (typeof v === "string" && v.length > 200) {

      out[k] = `${v.slice(0, 40)}…`;

    } else {

      out[k] = v;

    }

  }

  return out;

}

