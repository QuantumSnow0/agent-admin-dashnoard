import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import {
  buildAirtelSmsRequest,
  classifyOnfonResponse,
  composeAssignmentSms,
  decideAfterProviderResult,
  holdForMissingAirtelSmsConfig,
  isAirtel5gWebsiteLead,
  normalizeKenyanMobile,
  readAirtelSmsCredentials,
  retryDelayMinutes,
  type AirtelSmsCredentials,
  type OnfonClassification,
} from "../_shared/sms/customer-assignment-sms.ts";

/**
 * Sends queued Airtel 5G customer assignment SMS messages.
 * Auth matches dispatch-sweep: service role, inbound API key, or cron secret.
 * Acceptance does not call this function.
 */

type OutboxRow = {
  id: string;
  offer_id: string;
  lead_id: string;
  agent_id: string;
  attempt_count: number;
};

function verifyAccess(req: Request): boolean {
  const cronSecret = Deno.env.get("DISPATCH_SWEEP_CRON_SECRET");
  const providedCron = req.headers.get("x-cron-secret");
  if (cronSecret && providedCron === cronSecret) return true;

  const apiKey = Deno.env.get("INBOUND_LEAD_API_KEY");
  const providedKey = req.headers.get("x-inbound-api-key");
  if (apiKey && providedKey === apiKey) return true;

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceKey && token === serviceKey) return true;
  }
  return false;
}

async function submitOnfon(
  credentials: AirtelSmsCredentials,
  phone: string,
  text: string,
  unicode: boolean,
): Promise<OnfonClassification> {
  const request = buildAirtelSmsRequest(credentials, phone, text, unicode);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => null)) as {
      ErrorCode?: unknown;
      Data?: Array<{ MessageId?: unknown }>;
    } | null;
    if (!payload || typeof payload !== "object") {
      if (response.ok) return { outcome: "ambiguous", category: "unparseable_success" };
      return classifyOnfonResponse({ httpStatus: response.status, networkError: response.status >= 500 });
    }
    const rawCode = payload.ErrorCode;
    const errorCode = Number(
      typeof rawCode === "string" ? rawCode.replace(/\D/g, "") || rawCode : rawCode,
    );
    const messageIdRaw = payload.Data?.[0]?.MessageId;
    const messageId =
      typeof messageIdRaw === "string" || typeof messageIdRaw === "number"
        ? String(messageIdRaw)
        : null;
    return classifyOnfonResponse({
      httpStatus: response.status,
      errorCode: Number.isFinite(errorCode) ? errorCode : null,
      messageId,
      unparseableSuccess: response.ok && !Number.isFinite(errorCode),
    });
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (name === "TimeoutError" || name === "AbortError" || /aborted|timeout/i.test(message)) {
      return classifyOnfonResponse({ timedOut: true });
    }
    return classifyOnfonResponse({ networkError: true });
  }
}

async function finish(
  service: SupabaseClient,
  row: OutboxRow,
  patch: Record<string, unknown>,
) {
  const { error } = await service
    .from("customer_assignment_sms_outbox")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "sending");
  if (error) {
    console.error("customer-assignment-sms finish", { id: row.id, category: "finish_failed" });
  }
}

async function processRow(
  service: SupabaseClient,
  credentials: AirtelSmsCredentials,
  row: OutboxRow,
) {
  const [{ data: lead }, { data: agent }] = await Promise.all([
    service
      .from("inbound_leads")
      .select("id, source, plan_group, status, assigned_agent_id, customer_name, primary_phone")
      .eq("id", row.lead_id)
      .maybeSingle(),
    service
      .from("agents")
      .select("id, name, airtel_phone, safaricom_phone")
      .eq("id", row.agent_id)
      .maybeSingle(),
  ]);

  if (!lead || !agent) {
    await finish(service, row, { status: "skipped", skip_reason: "record_missing" });
    return "skipped";
  }
  if (
    !isAirtel5gWebsiteLead(lead.source, lead.plan_group) ||
    lead.status !== "assigned" ||
    lead.assigned_agent_id !== row.agent_id
  ) {
    await finish(service, row, { status: "skipped", skip_reason: "assignment_changed" });
    return "skipped";
  }

  const customerPhone = normalizeKenyanMobile(lead.primary_phone);
  if (!customerPhone) {
    await finish(service, row, { status: "skipped", skip_reason: "invalid_customer_phone" });
    return "skipped";
  }

  const composed = composeAssignmentSms({
    customerName: lead.customer_name,
    agentName: agent.name,
    airtelPhone: agent.airtel_phone,
    safaricomPhone: agent.safaricom_phone,
  });
  if (!composed.ok) {
    await finish(service, row, { status: "skipped", skip_reason: composed.reason });
    return "skipped";
  }

  const startedAt = new Date().toISOString();
  const { data: marked, error: markError } = await service
    .from("customer_assignment_sms_outbox")
    .update({ send_started_at: startedAt, updated_at: startedAt })
    .eq("id", row.id)
    .eq("status", "sending")
    .is("send_started_at", null)
    .select("id");
  if (markError || !marked?.length) {
    console.error("customer-assignment-sms", { id: row.id, category: "send_not_started" });
    return "sending";
  }

  try {
  const classification = await submitOnfon(credentials, customerPhone, composed.body, composed.unicode);
  const decision = decideAfterProviderResult(classification, row.attempt_count);
  const providerCode = "code" in classification ? classification.code : null;
  const patch: Record<string, unknown> = {
    status: decision.status,
    template_variant: composed.variant,
    error_category: classification.outcome === "accepted" ? null : classification.category,
    provider_error_code: classification.outcome === "accepted" ? null : providerCode,
  };
  if (classification.outcome === "accepted") {
    patch.provider_message_id = classification.messageId;
    patch.sent_at = new Date().toISOString();
    patch.next_attempt_at = null;
  } else if (decision.retry) {
    const delayMs = retryDelayMinutes(row.attempt_count) * 60 * 1000;
    patch.next_attempt_at = new Date(Date.now() + delayMs).toISOString();
    patch.claimed_at = null;
    patch.send_started_at = null;
  }
  await finish(service, row, patch);
  console.log("customer-assignment-sms", {
    id: row.id,
    offerId: row.offer_id,
    status: decision.status,
    category: classification.outcome === "accepted" ? "provider_accepted" : classification.category,
    segments: composed.segments,
  });
  return decision.status;
  } catch {
    await finish(service, row, {
      status: "ambiguous",
      error_category: "provider_outcome_unconfirmed",
    });
    console.error("customer-assignment-sms", { id: row.id, category: "provider_outcome_unconfirmed" });
    return "ambiguous";
  }
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!verifyAccess(req)) return jsonResponse({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  const service = createClient(supabaseUrl, serviceKey);
  const credentials = readAirtelSmsCredentials((name) => Deno.env.get(name));
  try {
    await service.rpc("expire_stale_customer_assignment_sms_claims");
    if (!credentials) {
      const hold = holdForMissingAirtelSmsConfig();
      console.error("customer-assignment-sms", { category: hold.category });
      return jsonResponse({ success: false, error: hold.category, claimed: 0 });
    }
    const { data: claimed, error: claimError } = await service.rpc(
      "claim_customer_assignment_sms",
      { batch_size: 15 },
    );
    if (claimError) {
      console.error("customer-assignment-sms claim", { category: "claim_failed" });
      return jsonResponse({ error: "Could not claim notifications" }, 500);
    }

    const rows = (claimed ?? []) as OutboxRow[];
    const counts: Record<string, number> = {};
    for (const row of rows) {
      try {
        const status = await processRow(service, credentials, row);
        counts[status] = (counts[status] ?? 0) + 1;
      } catch {
        const retry = row.attempt_count < 5;
        await finish(service, row, {
          status: retry ? "pending" : "failed",
          error_category: "worker_error",
          next_attempt_at: retry
            ? new Date(Date.now() + retryDelayMinutes(row.attempt_count) * 60 * 1000).toISOString()
            : null,
          claimed_at: null,
        });
        counts[retry ? "pending" : "failed"] = (counts[retry ? "pending" : "failed"] ?? 0) + 1;
        console.error("customer-assignment-sms row", { id: row.id, category: "worker_error" });
      }
    }

    return jsonResponse({ success: true, claimed: rows.length, counts });
  } catch (error: unknown) {
    console.error("customer-assignment-sms", {
      category: error instanceof Error ? error.name : "worker_error",
    });
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
