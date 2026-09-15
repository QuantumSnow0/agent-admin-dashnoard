/**
 * Onfon Media SMS provider adapter (Agent Hub canonical pathway).
 * Credentials from WAM_AI_SMS_* env only — never tool args or audit payloads.
 * Automated tests MUST inject a mock; live sends require explicit production enablement.
 */

export const ONFON_SEND_URL = "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS";
export const SMS_MAX_MESSAGE_LENGTH = 640;
export const SMS_PROVIDER_TIMEOUT_MS = 30_000;

export type SmsProviderConfig = {
  apiKey: string;
  clientId: string;
  accessKey: string;
  senderId: string;
  /** When true, refuse real HTTP (tests / misconfig). */
  dryRunOnly: boolean;
  timeoutMs: number;
};

export type SmsProviderResult =
  | {
      outcome: "provider_accepted";
      providerMessageId: string | null;
    }
  | {
      outcome: "provider_rejected" | "provider_timeout" | "provider_ambiguous";
      errorCategory: string;
      errorMessage: string;
      providerMessageId?: string | null;
    };

export function loadSmsProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: SmsProviderConfig } | { ok: false; error: string } {
  const apiKey = env.WAM_AI_SMS_API_KEY?.trim() || "";
  const clientId = env.WAM_AI_SMS_CLIENT_ID?.trim() || "";
  const accessKey = env.WAM_AI_SMS_ACCESS_KEY?.trim() || "";
  const senderId = env.WAM_AI_SMS_SENDER_ID?.trim() || "";
  const dryRunOnly =
    (env.WAM_AI_SMS_DRY_RUN?.trim() || "1") === "1" ||
    (env.WAM_AI_SMS_DRY_RUN?.trim() || "").toLowerCase() === "true";

  if (!apiKey || !clientId || !accessKey || !senderId) {
    return {
      ok: false,
      error: "SMS provider is not configured (missing WAM_AI_SMS_* credentials)",
    };
  }
  return {
    ok: true,
    config: {
      apiKey,
      clientId,
      accessKey,
      senderId,
      dryRunOnly,
      timeoutMs: SMS_PROVIDER_TIMEOUT_MS,
    },
  };
}

function needsUnicode(text: string): boolean {
  return /[^\x00-\x7F]/.test(text);
}

export type SmsSendInput = {
  msisdn: string;
  message: string;
};

export type SmsProvider = {
  senderId: string;
  send: (input: SmsSendInput) => Promise<SmsProviderResult>;
};

export function createOnfonSmsProvider(cfg: SmsProviderConfig): SmsProvider {
  return {
    senderId: cfg.senderId,
    async send(input) {
      if (cfg.dryRunOnly) {
        return {
          outcome: "provider_rejected",
          errorCategory: "sms_dry_run",
          errorMessage:
            "SMS dry-run is enabled (WAM_AI_SMS_DRY_RUN); no provider submission occurred",
        };
      }
      if (!/^254[17]\d{8}$/.test(input.msisdn)) {
        return {
          outcome: "provider_rejected",
          errorCategory: "validation",
          errorMessage: "Invalid normalized destination",
        };
      }
      try {
        const response = await fetch(ONFON_SEND_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            AccessKey: cfg.accessKey,
          },
          body: JSON.stringify({
            SenderId: cfg.senderId,
            IsUnicode: needsUnicode(input.message),
            IsFlash: false,
            MessageParameters: [{ Number: input.msisdn, Text: input.message }],
            ApiKey: cfg.apiKey,
            ClientId: cfg.clientId,
          }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          ErrorCode?: unknown;
          ErrorDescription?: unknown;
          Data?: Array<{ MessageId?: unknown }>;
        };
        const rawCode = payload.ErrorCode;
        const errorCode = Number(
          typeof rawCode === "string"
            ? rawCode.replace(/\D/g, "") || rawCode
            : rawCode,
        );
        const accepted =
          response.ok && Number.isFinite(errorCode) && errorCode === 0;
        const messageId =
          typeof payload.Data?.[0]?.MessageId === "string" ||
          typeof payload.Data?.[0]?.MessageId === "number"
            ? String(payload.Data[0].MessageId)
            : null;

        if (!accepted) {
          return {
            outcome: "provider_rejected",
            errorCategory: "provider_rejected",
            errorMessage: sanitizeProviderError(
              errorCode,
              payload.ErrorDescription,
              response.status,
            ),
            providerMessageId: messageId,
          };
        }
        return { outcome: "provider_accepted", providerMessageId: messageId };
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        const msg = err instanceof Error ? err.message : "SMS provider unavailable";
        if (name === "TimeoutError" || /aborted|timeout/i.test(msg)) {
          return {
            outcome: "provider_timeout",
            errorCategory: "provider_timeout",
            errorMessage: "SMS provider request timed out; outcome may be ambiguous",
          };
        }
        return {
          outcome: "provider_ambiguous",
          errorCategory: "provider_ambiguous",
          errorMessage: "SMS provider request failed with ambiguous outcome",
        };
      }
    },
  };
}

export function sanitizeProviderError(
  errorCode: number | undefined,
  description: unknown,
  httpStatus?: number,
): string {
  if (httpStatus && httpStatus >= 500) {
    return `SMS gateway unavailable (HTTP ${httpStatus})`;
  }
  const desc =
    typeof description === "string" && description.trim()
      ? description.trim().slice(0, 160)
      : null;
  if (errorCode !== undefined && Number.isFinite(errorCode)) {
    return desc
      ? `Provider rejected SMS (code ${errorCode}): ${desc}`
      : `Provider rejected SMS (code ${errorCode})`;
  }
  return desc ? `Provider rejected SMS: ${desc}` : "Provider rejected SMS";
}

/** Test / disposable adapter — never performs network I/O. */
export function createMockSmsProvider(handlers?: {
  send?: (input: SmsSendInput) => Promise<SmsProviderResult>;
  senderId?: string;
}): SmsProvider & { calls: SmsSendInput[] } {
  const calls: SmsSendInput[] = [];
  return {
    senderId: handlers?.senderId ?? "Wam-Apps",
    calls,
    async send(input) {
      calls.push(input);
      if (handlers?.send) return handlers.send(input);
      return { outcome: "provider_accepted", providerMessageId: "mock-msg-1" };
    },
  };
}
