import { createHash } from "crypto";

const SENSITIVE_KEY =
  /(phone|email|password|secret|token|national|imei|sr_number|otp|authorization|cookie|database_url|connection)/i;

export function redactParams(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 200) {
      out[k] = `${v.slice(0, 40)}…`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function hashParams(input: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(redactParams(input)))
    .digest("hex")
    .slice(0, 32);
}

export function sanitizeErrorMessage(err: unknown): { category: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  let message = raw
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, "postgres://[REDACTED]")
    .replace(/password=[^&\s]+/gi, "password=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]");

  if (/invalid_date_range|invalid_date/i.test(message)) {
    return { category: "validation", message: "Invalid date range" };
  }
  if (/invalid_limit/i.test(message)) {
    return { category: "validation", message: "Invalid limit" };
  }
  if (/unsupported_filter/i.test(message)) {
    return { category: "validation", message: "Unsupported filter" };
  }
  if (/ECONNREFUSED|ENOTFOUND|timeout|terminating connection/i.test(message)) {
    return { category: "database_unavailable", message: "Database unavailable" };
  }
  if (/permission denied|42501/i.test(message)) {
    return { category: "permission", message: "Permission denied" };
  }
  return { category: "internal", message: "Request failed" };
}

/**
 * Size-guard oversized payloads. Never returns a raw JSON preview of production data.
 * Callers must treat truncated=true as response_too_large (no data returned).
 */
export function truncateJson(value: unknown, maxChars: number): {
  payload: unknown;
  truncated: boolean;
} {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return { payload: value, truncated: false };
  return {
    payload: {
      truncated: true,
      message: "Response exceeded size limit; request a narrower range or lower limit",
    },
    truncated: true,
  };
}

/** Ensure analytics payloads never include obvious PII keys. */
export function assertNoPiiKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...assertNoPiiKeys(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        /^(customer_name|primary_phone|alternate_phone|email|national_id|airtel_sr_number|safaricom_imei|dedupe_phone_key|source_external_id|token)$/i.test(
          k,
        )
      ) {
        hits.push(`${path}.${k}`);
      }
      hits.push(...assertNoPiiKeys(v, `${path}.${k}`));
    }
  }
  return hits;
}
