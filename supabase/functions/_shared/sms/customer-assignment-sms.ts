/**
 * Pure helpers for the Airtel 5G customer assignment SMS.
 * No network, no secrets, and no logging of phone numbers.
 */

export const SMS_MAX_ATTEMPTS = 5;

/** Same Onfon endpoint the other WAM Apps SMS functions use. Credentials are separate. */
export const AIRTEL_SMS_ONFON_URL = "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS";

export const AIRTEL_SMS_CREDENTIAL_NAMES = [
  "AIRTEL_SMS_API_KEY",
  "AIRTEL_SMS_CLIENT_ID",
  "AIRTEL_SMS_ACCESS_KEY",
  "AIRTEL_SMS_SENDER_ID",
] as const;

export type AirtelSmsCredentials = {
  apiKey: string;
  clientId: string;
  accessKey: string;
  senderId: string;
};

/**
 * Reads only the dedicated Airtel customer-SMS account.
 * A missing value stays missing. WAM Apps ONFON_* secrets are not consulted.
 */
export function readAirtelSmsCredentials(
  read: (name: string) => string | undefined,
): AirtelSmsCredentials | null {
  const [apiKey, clientId, accessKey, senderId] = AIRTEL_SMS_CREDENTIAL_NAMES.map(
    (name) => read(name)?.trim() ?? "",
  );
  if (!apiKey || !clientId || !accessKey || !senderId) return null;
  return { apiKey, clientId, accessKey, senderId };
}

export function buildAirtelSmsRequest(
  credentials: AirtelSmsCredentials,
  phone: string,
  text: string,
  unicode: boolean,
) {
  return {
    url: AIRTEL_SMS_ONFON_URL,
    method: "POST" as const,
    headers: {
      "Content-Type": "application/json",
      AccessKey: credentials.accessKey,
    },
    body: {
      SenderId: credentials.senderId,
      IsUnicode: unicode,
      IsFlash: false,
      MessageParameters: [{ Number: phone, Text: text }],
      ApiKey: credentials.apiKey,
      ClientId: credentials.clientId,
    },
  };
}

/**
 * Missing dedicated credentials must not claim or send.
 * The outbox row stays pending, so a later run can send it once the secrets exist.
 */
export function holdForMissingAirtelSmsConfig(): {
  claim: false;
  send: false;
  fallbackToWamApps: false;
  preserveQueue: true;
  category: "airtel_sms_not_configured";
} {
  return {
    claim: false,
    send: false,
    fallbackToWamApps: false,
    preserveQueue: true,
    category: "airtel_sms_not_configured",
  };
}

const GSM_7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_7_EXT = "^{}\\[~]|€";

export type PhonePair = {
  primary: string | null;
  alternate: string | null;
};

export type SmsVariant = "one_number" | "two_numbers";

export type ComposedSms =
  | { ok: true; body: string; variant: SmsVariant; unicode: boolean; segments: number }
  | { ok: false; reason: "no_agent_phone" };

export type OnfonClassification =
  | { outcome: "accepted"; messageId: string | null }
  | { outcome: "ambiguous"; category: string }
  | { outcome: "retry"; category: string; code: number | null }
  | { outcome: "failed"; category: string; code: number | null };

export function isAirtel5gWebsiteLead(source: unknown, planGroup: unknown): boolean {
  return source === "airtel5grouter" && planGroup === "5G";
}

export function normalizeKenyanMobile(value: unknown): string | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  } else if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) {
    digits = `254${digits}`;
  }
  return /^254[17]\d{8}$/.test(digits) ? digits : null;
}

/** Local display. 2541… stays 01…; it is never rewritten to 07…. */
export function toLocalMobile(normalized: string): string {
  return `0${normalized.slice(3)}`;
}

export function customerFirstName(fullName: unknown): string {
  const cleaned = String(fullName ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "there";
  const token = cleaned.split(" ")[0] ?? "";
  const safe = token.replace(/[\r\n\t]/g, "");
  return safe || "there";
}

export function agentDisplayName(name: unknown): string {
  const cleaned = String(name ?? "").replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "your agent";
}

/** Airtel number is primary. Safaricom is alternate. Duplicates collapse. */
export function selectAgentPhones(airtel: unknown, safaricom: unknown): PhonePair {
  const primary = normalizeKenyanMobile(airtel);
  const alternateRaw = normalizeKenyanMobile(safaricom);
  const alternate = alternateRaw && alternateRaw !== primary ? alternateRaw : null;
  if (!primary && alternateRaw) {
    return { primary: alternateRaw, alternate: null };
  }
  return { primary, alternate };
}

export function isGsm7(text: string): boolean {
  for (const char of text) {
    if (!GSM_7_BASIC.includes(char) && !GSM_7_EXT.includes(char)) return false;
  }
  return true;
}

function gsm7Length(text: string): number {
  let length = 0;
  for (const char of text) {
    length += GSM_7_EXT.includes(char) ? 2 : 1;
  }
  return length;
}

export function smsSegments(text: string): { unicode: boolean; segments: number } {
  if (!isGsm7(text)) {
    const units = [...text].length;
    const segments = units <= 70 ? 1 : Math.ceil(units / 67);
    return { unicode: true, segments };
  }
  const units = gsm7Length(text);
  const segments = units <= 160 ? 1 : Math.ceil(units / 153);
  return { unicode: false, segments };
}

export function composeAssignmentSms(input: {
  customerName: unknown;
  agentName: unknown;
  airtelPhone: unknown;
  safaricomPhone: unknown;
}): ComposedSms {
  const phones = selectAgentPhones(input.airtelPhone, input.safaricomPhone);
  const local = [phones.primary, phones.alternate]
    .filter((phone): phone is string => Boolean(phone))
    .map(toLocalMobile);
  if (local.length === 0) return { ok: false, reason: "no_agent_phone" };

  const firstName = customerFirstName(input.customerName);
  const agentName = agentDisplayName(input.agentName);
  const intro = `Hi ${firstName}, ${agentName} is handling your Airtel 5G installation.`;
  const body =
    local.length === 1
      ? `${intro}\n\nAgent contact: ${local[0]}\n\nYour agent will contact you. You can also call or SMS this number.`
      : `${intro}\n\nPrimary: ${local[0]}\nAlternate: ${local[1]}\n\nYour agent will contact you. You can also call or SMS either number.`;

  const size = smsSegments(body);
  return {
    ok: true,
    body,
    variant: local.length === 1 ? "one_number" : "two_numbers",
    unicode: size.unicode,
    segments: size.segments,
  };
}

const RETRYABLE_ONFON_CODES = new Set([6, 8, 9, 21]);

export function classifyOnfonResponse(input: {
  timedOut?: boolean;
  networkError?: boolean;
  httpStatus?: number;
  errorCode?: number | null;
  messageId?: string | null;
  unparseableSuccess?: boolean;
}): OnfonClassification {
  if (input.timedOut) {
    return { outcome: "ambiguous", category: "provider_timeout" };
  }
  if (input.unparseableSuccess) {
    return { outcome: "ambiguous", category: "unparseable_success" };
  }
  const code = input.errorCode ?? null;
  if (input.httpStatus && input.httpStatus >= 200 && input.httpStatus < 300 && code === 0) {
    return { outcome: "accepted", messageId: input.messageId ?? null };
  }
  if (input.networkError || (input.httpStatus !== undefined && input.httpStatus >= 500) || input.httpStatus === 429) {
    return { outcome: "retry", category: "provider_unavailable", code };
  }
  if (code !== null && RETRYABLE_ONFON_CODES.has(code)) {
    return { outcome: "retry", category: "provider_transient", code };
  }
  if (code !== null || (input.httpStatus !== undefined && input.httpStatus >= 400)) {
    return { outcome: "failed", category: "provider_rejected", code };
  }
  return { outcome: "ambiguous", category: "provider_ambiguous" };
}

export function retryDelayMinutes(attemptCount: number): number {
  if (attemptCount <= 1) return 2;
  if (attemptCount === 2) return 5;
  if (attemptCount === 3) return 15;
  return 30;
}

/** A claim that expired before Onfon was called can be retried. One that reached Onfon cannot. */
export function recoverExpiredClaim(sendStartedAt: string | null): "pending" | "ambiguous" {
  return sendStartedAt ? "ambiguous" : "pending";
}

/**
 * The assignment update is already done before notification enqueue.
 * An enqueue failure must leave that assignment in place.
 */
export function acceptanceSurvivesEnqueueFailure(enqueue: () => void): {
  assigned: boolean;
  queued: boolean;
} {
  try {
    enqueue();
    return { assigned: true, queued: true };
  } catch {
    return { assigned: true, queued: false };
  }
}

export function decideAfterProviderResult(
  classification: OnfonClassification,
  attemptCount: number,
): { status: "sent" | "pending" | "failed" | "ambiguous"; retry: boolean } {
  if (classification.outcome === "accepted") {
    return { status: "sent", retry: false };
  }
  if (classification.outcome === "ambiguous" || classification.outcome === "failed") {
    return { status: classification.outcome, retry: false };
  }
  if (attemptCount >= SMS_MAX_ATTEMPTS) {
    return { status: "failed", retry: false };
  }
  return { status: "pending", retry: true };
}
