/**
 * Admin SMS via Onfon edge function (reuses existing ONFON_* secrets on Supabase).
 * Auth: pass the signed-in admin's access token (preferred), or service role if it matches.
 */

export type AdminSmsResult = {
  ok: boolean;
  sent: number;
  skipped: number;
  failed: number;
  error?: string;
  skippedDetails?: { agentId: string; reason: string }[];
  failedDetails?: { agentId: string; phone: string; error: string }[];
};

export async function sendAdminSms(input: {
  agentIds: string[];
  message: string;
  title?: string;
  recordInApp?: boolean;
  phoneTarget?: "airtel" | "safaricom" | "both";
  /** Signed-in admin JWT from Supabase session */
  accessToken: string;
}): Promise<AdminSmsResult> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const accessToken = input.accessToken?.trim();

  if (!baseUrl) {
    return {
      ok: false,
      sent: 0,
      skipped: 0,
      failed: 0,
      error: "Missing NEXT_PUBLIC_SUPABASE_URL",
    };
  }

  if (!accessToken) {
    return {
      ok: false,
      sent: 0,
      skipped: 0,
      failed: 0,
      error: "Missing admin session token",
    };
  }

  try {
    const res = await fetch(`${baseUrl}/functions/v1/admin-send-sms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentIds: input.agentIds,
        message: input.message,
        title: input.title,
        recordInApp: input.recordInApp !== false,
        phoneTarget: input.phoneTarget ?? "airtel",
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      sent?: number;
      skipped?: number;
      failed?: number;
      error?: string;
      skippedDetails?: { agentId: string; reason: string }[];
      failedDetails?: { agentId: string; phone: string; error: string }[];
    };

    if (!res.ok) {
      return {
        ok: false,
        sent: data.sent ?? 0,
        skipped: data.skipped ?? 0,
        failed: data.failed ?? 0,
        error: data.error || `SMS API failed (${res.status})`,
        skippedDetails: data.skippedDetails,
        failedDetails: data.failedDetails,
      };
    }

    return {
      ok: data.success === true || (data.sent ?? 0) > 0,
      sent: data.sent ?? 0,
      skipped: data.skipped ?? 0,
      failed: data.failed ?? 0,
      error:
        (data.failed ?? 0) > 0 || (data.sent ?? 0) === 0
          ? data.error ||
            (data.failedDetails?.[0]?.error ??
              data.skippedDetails?.[0]?.reason ??
              ((data.sent ?? 0) === 0 ? "No SMS delivered" : undefined))
          : undefined,
      skippedDetails: data.skippedDetails,
      failedDetails: data.failedDetails,
    };
  } catch (err) {
    return {
      ok: false,
      sent: 0,
      skipped: 0,
      failed: 0,
      error: err instanceof Error ? err.message : "SMS request failed",
    };
  }
}
