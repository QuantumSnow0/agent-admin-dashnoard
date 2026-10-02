import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import { dispatchLead } from "../_shared/dispatch/dispatch-service.ts";

/**
 * lead-outcome (v1)
 *
 * Agent reports KYC progress, install proof, or release.
 * Release redispatches when another agent is available; otherwise stays assigned.
 * Auth: agent JWT.
 *
 * On action=installed:
 *   Airtel → save Order ID and set status installed (payment still needs approval).
 *   Safaricom → save IMEI and set status pending_install.
 */

type Body = {
  leadId?: string;
  action?: string;
  airtelSrNumber?: string;
  safaricomImei?: string;
  notes?: string;
  /** ISO date or datetime for callback reminder (action=defer). */
  callbackAt?: string;
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
      "defer",
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

    // Airtel: Order ID → installed. Safaricom: IMEI → pending_install.
    if (action === "installed") {
      if (lead.status === "approved" || lead.status === "denied") {
        return jsonResponse(
          { error: "Payment for this lead is already decided" },
          409,
        );
      }

      if (lead.product === "safaricom" && lead.status === "pending_install") {
        return jsonResponse({
          success: true,
          status: "pending_install",
          idempotent: true,
        });
      }

      if (lead.product === "safaricom" && lead.status === "installed") {
        return jsonResponse({
          success: true,
          status: "installed",
          commissionKes: Number(lead.commission_earned_ksh) || undefined,
          idempotent: true,
        });
      }

      if (!lead.call_initiated_at) {
        return jsonResponse(
          { error: "Call the customer before submitting install proof" },
          409,
        );
      }

      if (lead.status === "assigned" && !lead.kyc_completed_at) {
        return jsonResponse(
          {
            error:
              "Mark the customer as contacted after the call, then submit install proof",
          },
          409,
        );
      }

      if (lead.product === "airtel") {
        const orderId = String(body.airtelSrNumber ?? "").trim();
        if (orderId.length < 3) {
          return jsonResponse(
            { error: "Enter a valid Airtel Connect Order ID" },
            400,
          );
        }

        const existing = String(lead.airtel_sr_number ?? "").trim();
        if (existing && existing.toLowerCase() !== orderId.toLowerCase()) {
          return jsonResponse({ error: "Order ID is already saved" }, 409);
        }
        if (
          existing &&
          existing.toLowerCase() === orderId.toLowerCase() &&
          lead.status === "installed"
        ) {
          return jsonResponse({
            success: true,
            status: "installed",
            idempotent: true,
          });
        }

        const { data: used, error: usedError } = await service.rpc(
          "airtel_order_id_is_used",
          { p_order_id: orderId, p_exclude_id: leadId },
        );
        if (usedError) {
          console.error("lead-outcome order id check:", usedError);
          return jsonResponse({ error: "Could not check this Order ID" }, 503);
        }
        if (used === true) {
          return jsonResponse({ error: "This Order ID is already used" }, 409);
        }

        const { error: updateError } = await service
          .from("inbound_leads")
          .update({
            status: "installed",
            airtel_sr_number: orderId,
            installed_at: lead.installed_at ?? now,
            commission_earned_ksh: null,
            metadata: {
              ...prevMetadata,
              installProof: {
                submittedAt: now,
                agentId: user.id,
                orderId,
              },
            },
          })
          .eq("id", leadId);

        if (updateError) {
          console.error("lead-outcome order id:", updateError);
          const message = String(updateError.message ?? "");
          return jsonResponse(
            {
              error: message.toLowerCase().includes("already used") ||
                  message.toLowerCase().includes("order_id")
                ? "This Order ID is already used"
                : "Failed to save Order ID",
            },
            message.toLowerCase().includes("already used") ||
              message.toLowerCase().includes("unique")
              ? 409
              : 500,
          );
        }

        if (lead.assigned_agent_id) {
          const { error: notifyError } = await service.from("notifications").insert({
            agent_id: lead.assigned_agent_id,
            related_id: leadId,
            title: "Order ID logged",
            message: `Customer '${lead.customer_name}' is installed on your side and waiting for confirmation.`,
            type: "LEAD_INSTALLED",
            is_read: false,
            metadata: {
              leadId,
              status: "installed",
              product: "airtel",
            },
          });
          if (notifyError) {
            console.error("lead-outcome order id notify:", notifyError);
          }
        }

        return jsonResponse({ success: true, status: "installed" });
      }

      if (lead.product !== "safaricom") {
        return jsonResponse(
          { error: "Unknown product — cannot mark installed" },
          400,
        );
      }

      const imei = String(body.safaricomImei ?? "").trim();
      if (!imei) {
        return jsonResponse(
          { error: "safaricomImei is required for Safaricom install" },
          400,
        );
      }

      const { error: updateError } = await service
        .from("inbound_leads")
        .update({
          status: "pending_install",
          safaricom_imei: imei,
          commission_earned_ksh: null,
          metadata: {
            ...prevMetadata,
            installProof: {
              submittedAt: now,
              agentId: user.id,
            },
          },
        })
        .eq("id", leadId);

      if (updateError) {
        console.error("lead-outcome install proof:", updateError);
        return jsonResponse({ error: "Failed to save IMEI" }, 500);
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
      // "Spoke to customer" — website already submitted to Airtel MS Forms.
      // No OTP / in-app registration gate (those were removed from the agent flow).
      // call_started may still be in flight from the dialer; set timestamp if missing.
      const { error: updateError } = await service
        .from("inbound_leads")
        .update({
          status: "kyc_completed",
          call_initiated_at: lead.call_initiated_at ?? now,
          kyc_completed_at: lead.kyc_completed_at ?? now,
          kyc_outcome: "completed",
          metadata: {
            ...prevMetadata,
            contactedAt: now,
            contactedBy: user.id,
          },
        })
        .eq("id", leadId);

      if (updateError) {
        return jsonResponse({ error: "Failed to update lead" }, 500);
      }

      return jsonResponse({ success: true, status: "kyc_completed" });
    }

    if (action === "defer") {
      const rawCallback = String(body.callbackAt ?? "").trim();
      if (!rawCallback) {
        return jsonResponse(
          { error: "Pick a callback date for the reminder" },
          400,
        );
      }

      // Accept YYYY-MM-DD or ISO datetime; wake at 08:00 Africa/Nairobi that day.
      const dateOnly = rawCallback.match(/^(\d{4}-\d{2}-\d{2})/);
      let callbackAt: Date;
      if (dateOnly) {
        callbackAt = new Date(`${dateOnly[1]}T08:00:00+03:00`);
      } else {
        callbackAt = new Date(rawCallback);
      }

      if (Number.isNaN(callbackAt.getTime())) {
        return jsonResponse({ error: "Invalid callback date" }, 400);
      }

      const startOfTodayEat = new Date();
      // Compare calendar days in EAT roughly via ISO date strings.
      const eatToday = new Date(
        startOfTodayEat.toLocaleString("en-US", { timeZone: "Africa/Nairobi" }),
      );
      eatToday.setHours(0, 0, 0, 0);
      if (callbackAt.getTime() < eatToday.getTime()) {
        return jsonResponse(
          { error: "Callback date must be today or later" },
          400,
        );
      }

      const maxDays = 62;
      const maxAt = new Date(eatToday.getTime() + maxDays * 24 * 60 * 60 * 1000);
      if (callbackAt.getTime() > maxAt.getTime()) {
        return jsonResponse(
          { error: "Callback date must be within the next two months" },
          400,
        );
      }

      const notes = String(body.notes ?? "").trim();
      const { data: agentRow } = await service
        .from("agents")
        .select("name")
        .eq("id", user.id)
        .maybeSingle();

      const { error: updateError } = await service
        .from("inbound_leads")
        .update({
          status: "deferred",
          assigned_agent_id: null,
          accepted_at: null,
          preferred_agent_id: user.id,
          callback_at: callbackAt.toISOString(),
          reassignment_count: (lead.reassignment_count ?? 0) + 1,
          metadata: {
            ...prevMetadata,
            lastDefer: {
              callbackAt: callbackAt.toISOString(),
              notes: notes || null,
              agentId: user.id,
              agentName: agentRow?.name ?? null,
              at: now,
              preservedCallInitiatedAt: lead.call_initiated_at ?? null,
              preservedKycCompletedAt: lead.kyc_completed_at ?? null,
            },
          },
        })
        .eq("id", leadId);

      if (updateError) {
        console.error("lead-outcome defer:", updateError);
        return jsonResponse({ error: "Failed to schedule reminder" }, 500);
      }

      return jsonResponse({
        success: true,
        status: "deferred",
        callbackAt: callbackAt.toISOString(),
      });
    }

    if (RELEASE_ACTIONS.has(action)) {
      const outcome = action === "release" ? "kyc_failed" : action;
      const notes = String(body.notes ?? "").trim();
      const previousStatus = lead.status;
      const previousAcceptedAt = lead.accepted_at ?? null;

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

      if (dispatchResult.outcome === "offered") {
        return jsonResponse({
          success: true,
          status: "offered",
          releaseReason: outcome,
          reassigned: true,
          dispatch: dispatchResult,
        });
      }

      const { error: restoreError } = await service
        .from("inbound_leads")
        .update({
          status: previousStatus,
          assigned_agent_id: user.id,
          accepted_at: previousAcceptedAt,
          kyc_outcome: outcome,
          metadata,
        })
        .eq("id", leadId);

      if (restoreError) {
        console.error("lead-outcome release restore:", restoreError);
        return jsonResponse({ error: "Failed to keep lead active" }, 500);
      }

      return jsonResponse({
        success: true,
        status: previousStatus,
        releaseReason: outcome,
        reassigned: false,
        dispatch: dispatchResult,
      });
    }

    return jsonResponse({ error: "Unhandled action" }, 400);
  } catch (err) {
    console.error("lead-outcome:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
