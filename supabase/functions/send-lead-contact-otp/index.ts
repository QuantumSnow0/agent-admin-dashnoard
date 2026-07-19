import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";

const OTP_TTL_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 3;
const ACTIVE_LEAD_STATUSES = new Set(["assigned", "kyc_in_progress"]);

function normalizeKenyanPhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) digits = `254${digits}`;
  return /^254[17]\d{8}$/.test(digits) ? digits : null;
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 5)}***${phone.slice(-3)}`;
}

function generateOtp(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

async function hashOtp(
  leadId: string,
  phone: string,
  code: string,
  pepper: string,
): Promise<string> {
  const value = new TextEncoder().encode(`${leadId}:${phone}:${code}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization" }, 401);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { leadId?: unknown };
    const leadId = String(body.leadId ?? "").trim();
    if (!leadId) {
      return jsonResponse({ error: "leadId is required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const onfonApiKey = Deno.env.get("ONFON_API_KEY");
    const onfonClientId = Deno.env.get("ONFON_CLIENT_ID");
    const onfonAccessKey = Deno.env.get("ONFON_ACCESS_KEY");
    const onfonSenderId = Deno.env.get("ONFON_SENDER_ID");
    const otpPepper = Deno.env.get("LEAD_OTP_PEPPER");

    if (
      !supabaseUrl ||
      !serviceKey ||
      !anonKey ||
      !onfonApiKey ||
      !onfonClientId ||
      !onfonAccessKey ||
      !onfonSenderId ||
      !otpPepper
    ) {
      console.error("send-lead-contact-otp: missing server configuration");
      return jsonResponse({ error: "SMS service is not configured" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const service = createClient(supabaseUrl, serviceKey);
    const { data: lead, error: leadError } = await service
      .from("inbound_leads")
      .select(
        "id, product, status, primary_phone, assigned_agent_id, contact_verified_at, kyc_started_at",
      )
      .eq("id", leadId)
      .maybeSingle();

    if (leadError || !lead) {
      return jsonResponse({ error: "Lead not found" }, 404);
    }
    if (lead.assigned_agent_id !== user.id) {
      return jsonResponse({ error: "Not your lead" }, 403);
    }
    if (lead.product !== "airtel") {
      return jsonResponse({ error: "Contact OTP is currently available for Airtel leads" }, 400);
    }
    if (lead.contact_verified_at) {
      return jsonResponse({
        success: true,
        alreadyVerified: true,
        verifiedAt: lead.contact_verified_at,
      });
    }
    if (!ACTIVE_LEAD_STATUSES.has(lead.status)) {
      return jsonResponse({ error: "This lead cannot be verified in its current status" }, 409);
    }

    const phone = normalizeKenyanPhone(String(lead.primary_phone ?? ""));
    if (!phone) {
      return jsonResponse({ error: "Customer phone number is invalid" }, 400);
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentAttempts, error: attemptsError } = await service
      .from("lead_contact_otp_attempts")
      .select("created_at")
      .eq("lead_id", leadId)
      .eq("agent_id", user.id)
      .in("provider_status", ["pending", "accepted"])
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false });

    if (attemptsError) {
      console.error("send-lead-contact-otp rate limit:", attemptsError.message);
      return jsonResponse({ error: "Could not check SMS limits" }, 500);
    }

    if ((recentAttempts?.length ?? 0) >= MAX_SENDS_PER_HOUR) {
      return jsonResponse(
        { error: "Too many codes sent. Try again in one hour." },
        429,
      );
    }

    const latestSentAt = recentAttempts?.[0]?.created_at
      ? new Date(recentAttempts[0].created_at).getTime()
      : 0;
    const secondsSinceLastSend = Math.floor((Date.now() - latestSentAt) / 1000);
    if (latestSentAt && secondsSinceLastSend < RESEND_COOLDOWN_SECONDS) {
      return jsonResponse(
        {
          error: `Wait ${RESEND_COOLDOWN_SECONDS - secondsSinceLastSend} seconds before resending.`,
          retryAfterSeconds: RESEND_COOLDOWN_SECONDS - secondsSinceLastSend,
        },
        429,
      );
    }

    const code = generateOtp();
    const codeHash = await hashOtp(leadId, phone, code, otpPepper);
    const expiresAt = new Date(
      Date.now() + OTP_TTL_MINUTES * 60 * 1000,
    ).toISOString();

    const { data: attempt, error: insertError } = await service
      .from("lead_contact_otp_attempts")
      .insert({
        lead_id: leadId,
        agent_id: user.id,
        phone,
        code_hash: codeHash,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (insertError || !attempt) {
      console.error("send-lead-contact-otp insert:", insertError?.message);
      return jsonResponse({ error: "Could not prepare verification code" }, 500);
    }

    let smsResponse: Response;
    try {
      smsResponse = await fetch(
        "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            AccessKey: onfonAccessKey,
          },
          body: JSON.stringify({
            SenderId: onfonSenderId,
            IsUnicode: false,
            IsFlash: false,
            MessageParameters: [
              {
                Number: phone,
                Text: `Your Wam-Apps customer verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. Share it only with the agent you are speaking to.`,
              },
            ],
            ApiKey: onfonApiKey,
            ClientId: onfonClientId,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (providerError: unknown) {
      await service
        .from("lead_contact_otp_attempts")
        .update({ provider_status: "failed" })
        .eq("id", attempt.id);
      console.error(
        "send-lead-contact-otp provider unavailable:",
        providerError instanceof Error ? providerError.name : "unknown",
      );
      return jsonResponse({ error: "SMS provider is temporarily unavailable" }, 502);
    }

    const providerPayload = (await smsResponse.json().catch(() => ({}))) as {
      ErrorCode?: unknown;
      ErrorDescription?: unknown;
      Data?: Array<{ MessageId?: unknown }>;
    };
    const providerErrorCode = Number(providerPayload.ErrorCode);
    const providerAccepted =
      smsResponse.ok &&
      Number.isFinite(providerErrorCode) &&
      providerErrorCode === 0;

    if (!providerAccepted) {
      await service
        .from("lead_contact_otp_attempts")
        .update({ provider_status: "failed" })
        .eq("id", attempt.id);
      console.error(
        "send-lead-contact-otp provider rejected:",
        smsResponse.status,
        Number.isFinite(providerErrorCode) ? providerErrorCode : "invalid_response",
      );
      return jsonResponse({ error: "SMS provider rejected the message" }, 502);
    }

    const providerMessageId = String(
      providerPayload.Data?.[0]?.MessageId ?? "",
    ).trim();
    const sentAt = new Date().toISOString();

    await Promise.all([
      service
        .from("lead_contact_otp_attempts")
        .update({
          provider_status: "accepted",
          provider_message_id: providerMessageId || null,
          sent_at: sentAt,
        })
        .eq("id", attempt.id),
      service
        .from("inbound_leads")
        .update({
          status: "kyc_in_progress",
          kyc_started_at: lead.kyc_started_at ?? sentAt,
        })
        .eq("id", leadId),
    ]);

    return jsonResponse({
      success: true,
      maskedPhone: maskPhone(phone),
      expiresInSeconds: OTP_TTL_MINUTES * 60,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "SMS send failed";
    console.error("send-lead-contact-otp:", message);
    return jsonResponse({ error: "Could not send verification code" }, 500);
  }
});
