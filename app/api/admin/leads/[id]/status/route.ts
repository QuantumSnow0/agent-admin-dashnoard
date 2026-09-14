import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { fetchAdminInboundLeadById } from "@/lib/admin-leads";
import { resolveLeadInstallConfirmKes } from "@/lib/lead-install-commission";
import { deliverPushNotification } from "@/lib/dispatch/push-delivery";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set([
  "pending_install",
  "installed",
  "rejected",
  "duplicate",
  "cancelled",
  "lost",
  "needs_reassignment",
  "kyc_completed",
]);

/**
 * Admin updates inbound lead status (mirrors registration status actions).
 * Confirming installed accrues flat install commission; payouts stay on agent_payments.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id: leadId } = await context.params;
  if (!leadId) {
    return NextResponse.json({ error: "Lead id required" }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = (await request.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nextStatus = String(body.status ?? "").trim();
  if (!ALLOWED_STATUSES.has(nextStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const { data: lead, error: leadError } = await service
      .from("inbound_leads")
      .select("*")
      .eq("id", leadId)
      .maybeSingle();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const prevMetadata =
      lead.metadata && typeof lead.metadata === "object"
        ? (lead.metadata as Record<string, unknown>)
        : {};

    const update: Record<string, unknown> = {
      status: nextStatus,
      metadata: prevMetadata,
    };

    if (nextStatus === "installed") {
      const { data: dispatchCfg } = await service
        .from("dispatch_config")
        .select(
          "lead_receiver_commission_kes, lead_receiver_commission_standard_kes, lead_receiver_commission_premium_kes",
        )
        .limit(1)
        .maybeSingle();

      const receiverStd = Number(
        dispatchCfg?.lead_receiver_commission_standard_kes ??
          dispatchCfg?.lead_receiver_commission_kes,
      );
      const receiverPrem = Number(
        dispatchCfg?.lead_receiver_commission_premium_kes ??
          dispatchCfg?.lead_receiver_commission_kes,
      );

      const commissionKes = resolveLeadInstallConfirmKes({
        source: lead.source,
        submitted_by_agent_id: lead.submitted_by_agent_id,
        preferredPackage: lead.plan_label ?? lead.preferred_package,
        existingCommissionKes: lead.commission_earned_ksh,
        receiverFees: {
          standard: Number.isFinite(receiverStd) ? receiverStd : 0,
          premium: Number.isFinite(receiverPrem) ? receiverPrem : 0,
        },
      });

      update.installed_at = lead.installed_at ?? now;
      update.commission_earned_ksh = commissionKes;
      update.metadata = {
        ...prevMetadata,
        installCommission: {
          amountKes: commissionKes,
          confirmedAt: now,
          confirmedByAdminId: auth.user.id,
          proofReference:
            lead.product === "airtel"
              ? String(lead.airtel_sr_number ?? "").trim() || null
              : String(lead.safaricom_imei ?? "").trim() || null,
        },
      };
    }

    if (nextStatus === "pending_install") {
      update.commission_earned_ksh = null;
      update.installed_at = null;
    }

    if (
      nextStatus === "rejected" ||
      nextStatus === "duplicate" ||
      nextStatus === "cancelled" ||
      nextStatus === "lost" ||
      nextStatus === "needs_reassignment"
    ) {
      if (lead.status !== "installed") {
        update.commission_earned_ksh = null;
        update.installed_at = null;
      }
    }

    const { error: updateError } = await service
      .from("inbound_leads")
      .update(update)
      .eq("id", leadId);

    if (updateError) {
      console.error("[admin/leads status]", updateError);
      return NextResponse.json(
        { error: updateError.message || "Failed to update status" },
        { status: 500 },
      );
    }

    if (
      nextStatus === "installed" &&
      lead.assigned_agent_id &&
      lead.status !== "installed"
    ) {
      const amount = Number(update.commission_earned_ksh) || 0;
      try {
        const { data: notification, error: notifyError } = await service
          .from("notifications")
          .insert({
            agent_id: lead.assigned_agent_id,
            related_id: leadId,
            title: "Installation confirmed",
            message:
              amount > 0
                ? `Admin confirmed install for ${lead.customer_name}. Commission KSh ${amount} will be paid with your next payout.`
                : `Admin confirmed install for ${lead.customer_name}.`,
            type: "LEAD_INSTALLED",
            is_read: false,
            metadata: {
              leadId,
              commissionKes: amount,
              product: lead.product,
            },
          })
          .select("id, agent_id, type, title, message, related_id, metadata")
          .single();

        if (notifyError) {
          console.error("[admin/leads status] notify insert:", notifyError);
        } else if (notification) {
          const push = await deliverPushNotification(notification);
          if (!push.ok) {
            console.error("[admin/leads status] push failed:", push.error);
          }
        }
      } catch (notifyErr) {
        console.error("[admin/leads status] notify:", notifyErr);
      }
    }

    const refreshed = await fetchAdminInboundLeadById(service, leadId);
    return NextResponse.json({
      success: true,
      lead: refreshed.lead,
    });
  } catch (err) {
    console.error("[admin/leads status PATCH]", err);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
