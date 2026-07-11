import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import { dispatchLead } from "../_shared/dispatch/dispatch-service.ts";

/**
 * lead-outcome (v1)
 *
 * Agent reports KYC progress, install proof, or releases lead for reassignment.
 * Auth: agent JWT.
 *
 * Body: {
 *   leadId: string,
 *   action: "kyc_started" | "kyc_completed" | "unreachable" | "declined" |
 *           "kyc_failed" | "installed" | "release",
 *   airtelSrNumber?: string,   // required when action=installed + product=airtel
 *   safaricomImei?: string,    // required when action=installed + product=safaricom
 *   notes?: string             // stored in metadata.notes (v1)
 * }
 *
 * Future: Airtel Connect deeplink callback may auto-set kyc_completed.
 */

type Body = {
  leadId?: string;
  action?: string;
  airtelSrNumber?: string;
  safaricomImei?: string;
  notes?: string;
};

const RELEASE_ACTIONS = new Set([
  "unreachable",
  "declined",
  "kyc_failed",
  "release",
]);

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
    const body = (await req.json()) as Body;
    const leadId = String(body.leadId ?? "").trim();
    const action = String(body.action ?? "").trim();

    const validActions = new Set([
      "kyc_started",
      "kyc_completed",
      "unreachable",
      "declined",
      "kyc_failed",
      "installed",
      "release",
    ]);

    if (!leadId || !validActions.has(action)) {
      return jsonResponse({ error: "leadId and valid action are required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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
      .select("*")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      return jsonResponse({ error: "Lead not found" }, 404);
    }

    if (lead.assigned_agent_id !== user.id) {
      return jsonResponse({ error: "Not your assigned lead" }, 403);
    }

    const now = new Date().toISOString();
    const metadata = {
      ...(lead.metadata ?? {}),
      ...(body.notes ? { lastOutcomeNotes: body.notes } : {}),
    };

    // --- Installed (requires proof) ---
    if (action === "installed") {
      if (lead.product === "airtel") {
        const sr = String(body.airtelSrNumber ?? "").trim();
        if (!sr) {
          return jsonResponse({ error: "airtelSrNumber is required for Airtel install" }, 400);
        }
        await service
          .from("inbound_leads")
          .update({
            status: "installed",
            installed_at: now,
            airtel_sr_number: sr,
            metadata,
          })
          .eq("id", leadId);

        return jsonResponse({ success: true, status: "installed" });
      }

      if (lead.product === "safaricom") {
        const imei = String(body.safaricomImei ?? "").trim();
        if (!imei) {
          return jsonResponse({ error: "safaricomImei is required for Safaricom install" }, 400);
        }
        await service
          .from("inbound_leads")
          .update({
            status: "installed",
            installed_at: now,
            safaricom_imei: imei,
            metadata,
          })
          .eq("id", leadId);

        return jsonResponse({ success: true, status: "installed" });
      }
    }

    // --- KYC started (opened Airtel Connect) ---
    if (action === "kyc_started") {
      await service
        .from("inbound_leads")
        .update({
          status: "kyc_in_progress",
          kyc_started_at: lead.kyc_started_at ?? now,
          metadata,
        })
        .eq("id", leadId);

      return jsonResponse({ success: true, status: "kyc_in_progress" });
    }

    // --- KYC completed (agent claim) ---
    if (action === "kyc_completed") {
      await service
        .from("inbound_leads")
        .update({
          status: "kyc_completed",
          kyc_completed_at: now,
          kyc_outcome: "completed",
          metadata,
        })
        .eq("id", leadId);

      return jsonResponse({ success: true, status: "kyc_completed" });
    }

    // --- Release / failure → reassignment pipeline ---
    if (RELEASE_ACTIONS.has(action)) {
      const outcome =
        action === "release" ? "kyc_failed" : action;

      await service
        .from("inbound_leads")
        .update({
          status: "needs_reassignment",
          assigned_agent_id: null,
          accepted_at: null,
          kyc_outcome: outcome,
          reassignment_count: (lead.reassignment_count ?? 0) + 1,
          metadata,
        })
        .eq("id", leadId);

      const dispatchResult = await dispatchLead(service, leadId);

      // If no agents left in county, dispatchLead moves to admin_queue
      return jsonResponse({
        success: true,
        status: "needs_reassignment",
        dispatch: dispatchResult,
      });
    }

    return jsonResponse({ error: "Unhandled action" }, 400);
  } catch (err) {
    console.error("lead-outcome:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
