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
 * On action=installed → status pending_install (admin confirms commission + payouts).
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
      "call_started",
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
      return jsonResponse({ error: "Not your lead" }, 403);
    }

    const now = new Date().toISOString();
    const prevMetadata =
      lead.metadata && typeof lead.metadata === "object"
        ? (lead.metadata as Record<string, unknown>)
        : {};

    if (action === "call_started") {
      const { error: updateError } = await service
        .from("inbound_leads")
        .update({
          call_initiated_at: now,
          metadata: prevMetadata,
        })
        .eq("id", leadId);

      if (updateError) {
        return jsonResponse({ error: "Failed to record call" }, 500);
      }

      return jsonResponse({ success: true, status: lead.status });
    }

    // --- Agent submits install proof → pending_install (admin confirms commission) ---
    if (action === "installed") {
      if (lead.status === "installed") {
        return jsonResponse({
          success: true,
          status: "installed",
          commissionKes: Number(lead.commission_earned_ksh) || undefined,
          idempotent: true,
        });
      }

      if (lead.status === "pending_install") {
        return jsonResponse({
          success: true,
          status: "pending_install",
          idempotent: true,
        });
      }

      const proofUpdate: Record<string, unknown> = {
        status: "pending_install",
        // Proof received; commission + installed_at set when admin confirms.
        commission_earned_ksh: null,
        metadata: {
          ...prevMetadata,
          installProof: {
            submittedAt: now,
            agentId: user.id,
          },
        },
      };

      if (lead.product === "airtel") {
        const sr = String(body.airtelSrNumber ?? "").trim();
        if (!sr) {
          return jsonResponse(
            { error: "airtelSrNumber is required for Airtel install" },
            400,
          );
        }
        proofUpdate.airtel_sr_number = sr;
      } else if (lead.product === "safaricom") {
        const imei = String(body.safaricomImei ?? "").trim();
        if (!imei) {
          return jsonResponse(
            { error: "safaricomImei is required for Safaricom install" },
            400,
          );
        }
        proofUpdate.safaricom_imei = imei;
      } else {
        return jsonResponse(
          { error: "Unknown product — cannot mark installed" },
          400,
        );
      }

      const { error: updateError } = await service
        .from("inbound_leads")
        .update(proofUpdate)
        .eq("id", leadId);

      if (updateError) {
        console.error("lead-outcome install proof:", updateError);
        return jsonResponse(
          {
            error:
              lead.product === "airtel"
                ? "Failed to save SR number"
                : "Failed to save IMEI",
          },
          500,
        );
      }

      return jsonResponse({
        success: true,
        status: "pending_install",
      });
    }

    if (action === "kyc_started") {
      const { error: updateError } = await service
        .from("inbound_leads")
        .update({
          status: "kyc_in_progress",
          kyc_started_at: lead.kyc_started_at ?? now,
          metadata: prevMetadata,
        })
        .eq("id", leadId);

      if (updateError) {
        return jsonResponse({ error: "Failed to update lead" }, 500);
      }

      return jsonResponse({ success: true, status: "kyc_in_progress" });
    }

    if (action === "kyc_completed") {
      // Airtel KYC must come from verified contact + MS Forms submission.
      // Older clients that still call this action directly are rejected.
      if (lead.product === "airtel") {
        if (!lead.contact_verified_at) {
          return jsonResponse(
            {
              error:
                "Verify customer contact, then submit the registration form",
            },
            409,
          );
        }

        if (!lead.registration_id) {
          return jsonResponse(
            {
              error:
                "Submit the prefilled registration before marking KYC complete",
            },
            409,
          );
        }

        const { data: registration, error: registrationError } = await service
          .from("customer_registrations")
          .select("id, ms_forms_response_id, inbound_lead_id, agent_id")
          .eq("id", lead.registration_id)
          .maybeSingle();

        if (registrationError || !registration) {
          return jsonResponse({ error: "Linked registration not found" }, 409);
        }

        if (
          registration.agent_id !== user.id ||
          registration.inbound_lead_id !== leadId ||
          !registration.ms_forms_response_id
        ) {
          return jsonResponse(
            {
              error:
                "Airtel KYC completes only after registration submission succeeds",
            },
            409,
          );
        }
      }

      const { error: updateError } = await service
        .from("inbound_leads")
        .update({
          status: "kyc_completed",
          kyc_completed_at: lead.kyc_completed_at ?? now,
          kyc_outcome: "completed",
          metadata: prevMetadata,
        })
        .eq("id", leadId);

      if (updateError) {
        return jsonResponse({ error: "Failed to update lead" }, 500);
      }

      return jsonResponse({ success: true, status: "kyc_completed" });
    }

    if (RELEASE_ACTIONS.has(action)) {
      const outcome = action === "release" ? "kyc_failed" : action;
      const notes = String(body.notes ?? "").trim();

      const { data: agentRow } = await service
        .from("agents")
        .select("name")
        .eq("id", user.id)
        .maybeSingle();

      const metadata = {
        ...prevMetadata,
        lastRelease: {
          reason: outcome,
          action,
          notes: notes || null,
          agentId: user.id,
          agentName: agentRow?.name ?? null,
          at: now,
        },
      };

      const { error: updateError } = await service
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

      if (updateError) {
        console.error("lead-outcome release:", updateError);
        return jsonResponse({ error: "Failed to release lead" }, 500);
      }

      const dispatchResult = await dispatchLead(service, leadId, {
        excludeAgentIds: [user.id],
      });

      return jsonResponse({
        success: true,
        status:
          dispatchResult.outcome === "offered"
            ? "offered"
            : dispatchResult.outcome === "admin_queue"
              ? "admin_queue"
              : "needs_reassignment",
        releaseReason: outcome,
        dispatch: dispatchResult,
      });
    }

    return jsonResponse({ error: "Unhandled action" }, 400);
  } catch (err) {
    console.error("lead-outcome:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
