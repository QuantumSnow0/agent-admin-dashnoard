// Admin bulk SMS via Onfon (same credentials as OTP / registration SMS).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";

const ONFON_URL = "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS";
const SEND_CONCURRENCY = 5;

function normalizeKenyanPhone(value: unknown): string | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) digits = `254${digits}`;
  return /^254[17]\d{8}$/.test(digits) ? digits : null;
}

function isServiceRoleToken(token: string): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  return Boolean(serviceKey && token === serviceKey);
}

async function assertAdminCaller(req: Request): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const token = auth.slice(7).trim();
  if (!token) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  // Scripts / internal callers with the current service role key.
  if (isServiceRoleToken(token)) {
    return { ok: true };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return { ok: false, status: 500, error: "Missing Supabase env" };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(token);

  if (userError || !user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const service = createClient(supabaseUrl, serviceKey);
  const { data: agent } = await service
    .from("agents")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!agent?.is_admin) {
    return { ok: false, status: 403, error: "Admin access required" };
  }

  return { ok: true };
}

const ONFON_ERROR_HINTS: Record<number, string> = {
  3: "SenderId cannot be blank — check ONFON_SENDER_ID secret",
  4: "Message cannot be blank",
  5: "Message properties cannot be blank",
  6: "Something went wrong at Onfon",
  7: "Invalid API credentials — check ONFON_API_KEY / CLIENT_ID / ACCESS_KEY",
  8: "Onfon user account inactive",
  9: "Onfon account locked",
  10: "Unauthorized API access",
  11: "Unauthorized IP address",
  13: "Invalid mobile number",
  15: "Invalid SenderId — must match an approved Onfon sender (e.g. Wam-Apps)",
  20: "Message or mobile number cannot be blank",
  21: "Insufficient wallet credits on Onfon",
  23: "Parameter missing",
  24: "Invalid template or template mismatch",
  39: "Spam message detected",
  42: "Max mobile number limit exceeded",
};

function needsUnicode(text: string): boolean {
  // GSM-7 basic set is enough for ASCII; anything outside → unicode
  return /[^\x00-\x7F]/.test(text);
}

function formatOnfonError(
  errorCode: number | undefined,
  description: unknown,
  httpStatus?: number,
): string {
  if (httpStatus && httpStatus >= 500) {
    return `Onfon gateway unavailable (HTTP ${httpStatus}). Their SMS API is down or blocking requests — try again in a few minutes. Lead OTP SMS would fail the same way right now.`;
  }

  const desc =
    typeof description === "string" && description.trim()
      ? description.trim()
      : null;
  const hint =
    errorCode !== undefined ? ONFON_ERROR_HINTS[errorCode] : undefined;
  const codePart =
    errorCode !== undefined && Number.isFinite(errorCode)
      ? `Onfon ${String(errorCode).padStart(3, "0")}`
      : httpStatus
        ? `HTTP ${httpStatus}`
        : "Onfon";
  if (hint) return `${codePart}: ${hint}`;
  if (desc) return `${codePart}: ${desc}`;
  return `${codePart}: SMS provider rejected the message`;
}

async function sendOnfonOne(
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string; errorCode?: number }> {
  const onfonApiKey = Deno.env.get("ONFON_API_KEY")?.trim();
  const onfonClientId = Deno.env.get("ONFON_CLIENT_ID")?.trim();
  const onfonAccessKey = Deno.env.get("ONFON_ACCESS_KEY")?.trim();
  const onfonSenderId = Deno.env.get("ONFON_SENDER_ID")?.trim();
  if (!onfonApiKey || !onfonClientId || !onfonAccessKey || !onfonSenderId) {
    return { ok: false, error: "SMS service is not configured (missing ONFON_* secrets)" };
  }

  try {
    const response = await fetch(ONFON_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        AccessKey: onfonAccessKey,
      },
      body: JSON.stringify({
        SenderId: onfonSenderId,
        IsUnicode: needsUnicode(text),
        IsFlash: false,
        MessageParameters: [{ Number: phone, Text: text }],
        ApiKey: onfonApiKey,
        ClientId: onfonClientId,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ErrorCode?: unknown;
      ErrorDescription?: unknown;
    };
    const rawCode = payload.ErrorCode;
    const errorCode = Number(
      typeof rawCode === "string" ? rawCode.replace(/\D/g, "") || rawCode : rawCode,
    );
    const accepted =
      response.ok && Number.isFinite(errorCode) && errorCode === 0;

    if (!accepted) {
      const code = Number.isFinite(errorCode) ? errorCode : undefined;
      console.error(
        "admin-send-sms Onfon reject:",
        response.status,
        code,
        payload.ErrorDescription,
      );
      return {
        ok: false,
        errorCode: code,
        error: formatOnfonError(code, payload.ErrorDescription, response.status),
      };
    }
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "SMS provider unavailable",
    };
  }
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const access = await assertAdminCaller(req);
  if (!access.ok) {
    return jsonResponse({ error: access.error }, access.status);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      agentIds?: unknown;
      message?: unknown;
      title?: unknown;
      recordInApp?: unknown;
      phoneTarget?: unknown;
    };

    const message = String(body.message ?? "").trim();
    const title =
      String(body.title ?? "").trim() || "SMS from WAM Apps";
    const recordInApp = body.recordInApp !== false;
    const phoneTargetRaw = String(body.phoneTarget ?? "airtel").toLowerCase();
    const phoneTarget =
      phoneTargetRaw === "safaricom" || phoneTargetRaw === "both"
        ? phoneTargetRaw
        : "airtel";
    const agentIds = Array.isArray(body.agentIds)
      ? body.agentIds
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .map((id) => id.trim())
      : [];

    if (!message) {
      return jsonResponse({ error: "Message is required" }, 400);
    }
    if (message.length > 640) {
      return jsonResponse(
        { error: "Message is too long (max 640 characters)." },
        400,
      );
    }
    if (agentIds.length === 0) {
      return jsonResponse({ error: "Select at least one agent" }, 400);
    }
    if (agentIds.length > 300) {
      return jsonResponse({ error: "Too many recipients (max 300)." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Missing Supabase env" }, 500);
    }

    const service = createClient(supabaseUrl, serviceKey);
    const { data: agents, error: agentsError } = await service
      .from("agents")
      .select("id, name, airtel_phone, safaricom_phone")
      .in("id", agentIds);

    if (agentsError) {
      return jsonResponse({ error: agentsError.message }, 500);
    }

    const recipients: {
      agentId: string;
      phone: string;
      carrier: "airtel" | "safaricom";
      name: string | null;
    }[] = [];
    const skipped: { agentId: string; reason: string }[] = [];
    const seenPhones = new Set<string>();

    for (const id of agentIds) {
      const agent = (agents ?? []).find((a) => a.id === id);
      if (!agent) {
        skipped.push({ agentId: id, reason: "Agent not found" });
        continue;
      }

      const candidates: { raw: unknown; carrier: "airtel" | "safaricom" }[] =
        [];
      if (phoneTarget === "airtel" || phoneTarget === "both") {
        candidates.push({ raw: agent.airtel_phone, carrier: "airtel" });
      }
      if (phoneTarget === "safaricom" || phoneTarget === "both") {
        candidates.push({
          raw: agent.safaricom_phone,
          carrier: "safaricom",
        });
      }

      let addedForAgent = 0;
      for (const candidate of candidates) {
        const phone = normalizeKenyanPhone(candidate.raw);
        if (!phone) continue;
        if (seenPhones.has(phone)) {
          skipped.push({
            agentId: id,
            reason: `Duplicate ${candidate.carrier} number already queued`,
          });
          continue;
        }
        seenPhones.add(phone);
        recipients.push({
          agentId: id,
          phone,
          carrier: candidate.carrier,
          name: agent.name ?? null,
        });
        addedForAgent += 1;
      }

      if (addedForAgent === 0) {
        const label =
          phoneTarget === "both"
            ? "No valid Airtel or Safaricom phone on profile"
            : phoneTarget === "safaricom"
              ? "No valid Safaricom phone on profile"
              : "No valid Airtel phone on profile";
        skipped.push({ agentId: id, reason: label });
      }
    }

    let sent = 0;
    const failed: { agentId: string; phone: string; error: string }[] = [];

    for (let i = 0; i < recipients.length; i += SEND_CONCURRENCY) {
      const chunk = recipients.slice(i, i + SEND_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (r) => {
          const outcome = await sendOnfonOne(r.phone, message);
          return { recipient: r, outcome };
        }),
      );
      for (const { recipient, outcome } of results) {
        if (outcome.ok) {
          sent += 1;
        } else {
          failed.push({
            agentId: recipient.agentId,
            phone: recipient.phone,
            error: outcome.error ?? "Send failed",
          });
        }
      }
    }

    const providerError =
      failed[0]?.error ??
      (sent === 0 && skipped[0] ? skipped[0].reason : undefined);

    const blastId = crypto.randomUUID();
    const sentAgentIds = [
      ...new Set(
        recipients
          .filter((r) => !failed.some((f) => f.agentId === r.agentId && f.phone === r.phone))
          .map((r) => r.agentId),
      ),
    ];

    if (recordInApp && sentAgentIds.length > 0) {
      const rows = sentAgentIds.map((agent_id) => ({
        agent_id,
        type: "SYSTEM_ANNOUNCEMENT",
        title,
        message,
        is_read: false,
        metadata: {
          source: "admin_dashboard",
          custom: true,
          kind: "sms",
          channel: "sms",
          phoneTarget,
          blastId,
        },
      }));
      const { error: insertError } = await service
        .from("notifications")
        .insert(rows);
      if (insertError) {
        console.error("admin-send-sms notification insert:", insertError.message);
      }
    }

    return jsonResponse({
      success: failed.length === 0 && sent > 0,
      sent,
      skipped: skipped.length,
      failed: failed.length,
      phoneTarget,
      error: providerError,
      skippedDetails: skipped.slice(0, 20),
      failedDetails: failed.slice(0, 20),
      blastId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "SMS send failed";
    console.error("admin-send-sms:", message);
    return jsonResponse({ error: message }, 500);
  }
});
