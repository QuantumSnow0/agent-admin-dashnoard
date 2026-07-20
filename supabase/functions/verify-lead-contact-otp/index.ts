import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";

const MAX_VERIFY_ATTEMPTS = 3;

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
    const body = (await req.json().catch(() => ({}))) as {
      leadId?: unknown;
      code?: unknown;
    };
    const leadId = String(body.leadId ?? "").trim();
    const code = String(body.code ?? "").replace(/\D/g, "");

    if (!leadId || !/^\d{6}$/.test(code)) {
      return jsonResponse({ error: "leadId and a 6-digit code are required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const otpPepper = Deno.env.get("LEAD_OTP_PEPPER");

    if (!supabaseUrl || !serviceKey || !anonKey || !otpPepper) {
      console.error("verify-lead-contact-otp: missing server configuration");
      return jsonResponse({ error: "Verification service is not configured" }, 500);
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
      .select("id, assigned_agent_id, contact_verified_at")
      .eq("id", leadId)
      .maybeSingle();

    if (leadError || !lead) {
      return jsonResponse({ error: "Lead not found" }, 404);
    }
    if (lead.assigned_agent_id !== user.id) {
      return jsonResponse({ error: "Not your lead" }, 403);
    }
    if (lead.contact_verified_at) {
      return jsonResponse({
        success: true,
        alreadyVerified: true,
        verifiedAt: lead.contact_verified_at,
      });
    }

    const { data: attempt, error: attemptError } = await service
      .from("lead_contact_otp_attempts")
      .select("id, phone, code_hash, attempts, expires_at")
      .eq("lead_id", leadId)
      .eq("agent_id", user.id)
      .eq("provider_status", "accepted")
      .is("verified_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attemptError) {
      console.error("verify-lead-contact-otp lookup:", attemptError.message);
      return jsonResponse({ error: "Could not check confirmation code" }, 500);
    }
    if (!attempt) {
      return jsonResponse({ error: "Send a new confirmation code first" }, 404);
    }
    if (new Date(attempt.expires_at).getTime() <= Date.now()) {
      return jsonResponse({ error: "This code has expired. Send a new one." }, 410);
    }
    if (Number(attempt.attempts) >= MAX_VERIFY_ATTEMPTS) {
      return jsonResponse({ error: "Too many incorrect attempts. Send a new code." }, 429);
    }

    const submittedHash = await hashOtp(leadId, attempt.phone, code, otpPepper);
    if (submittedHash !== attempt.code_hash) {
      const nextAttempts = Number(attempt.attempts) + 1;
      await service
        .from("lead_contact_otp_attempts")
        .update({ attempts: nextAttempts })
        .eq("id", attempt.id);

      return jsonResponse(
        {
          error:
            nextAttempts >= MAX_VERIFY_ATTEMPTS
              ? "Too many incorrect attempts. Send a new code."
              : "Incorrect confirmation code",
          attemptsRemaining: Math.max(0, MAX_VERIFY_ATTEMPTS - nextAttempts),
        },
        nextAttempts >= MAX_VERIFY_ATTEMPTS ? 429 : 400,
      );
    }

    const verifiedAt = new Date().toISOString();
    const { error: verifyUpdateError } = await service
      .from("lead_contact_otp_attempts")
      .update({ verified_at: verifiedAt })
      .eq("id", attempt.id);

    if (verifyUpdateError) {
      console.error("verify-lead-contact-otp attempt update:", verifyUpdateError.message);
      return jsonResponse({ error: "Could not save verification" }, 500);
    }

    const { error: leadUpdateError } = await service
      .from("inbound_leads")
      .update({
        contact_verified_at: verifiedAt,
        contact_verified_phone: attempt.phone,
        contact_verification_method: "sms_otp",
      })
      .eq("id", leadId)
      .eq("assigned_agent_id", user.id);

    if (leadUpdateError) {
      console.error("verify-lead-contact-otp lead update:", leadUpdateError.message);
      return jsonResponse({ error: "Code verified but lead update failed" }, 500);
    }

    return jsonResponse({ success: true, verifiedAt });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Verification failed";
    console.error("verify-lead-contact-otp:", message);
    return jsonResponse({ error: "Could not verify the code" }, 500);
  }
});
