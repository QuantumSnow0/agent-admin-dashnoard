import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { fetchAdminInboundLeadById } from "@/lib/admin-leads";
import { deliverPushNotification } from "@/lib/dispatch/push-delivery";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set([
  "pending_install",
  "installed",
  "approved",
  "denied",
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

  let body: { status?: string; amountKes?: number; mpesaReference?: string; reason?: string };
  try {
    body = (await request.json()) as {
      status?: string;
      amountKes?: number;
      mpesaReference?: string;
      reason?: string;
    };
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
      return NextResponse.json(
        { error: "Approve with an amount and an M-Pesa reference" },
        { status: 400 },
      );
    }

    if (nextStatus === "approved" || nextStatus === "denied") {
      const waitingStatus =
        lead.product === "airtel" ? "installed" : "pending_install";
      if (lead.status !== waitingStatus) {
        return NextResponse.json(
          {
            error:
              lead.product === "airtel"
                ? "Only an installed lead can be approved or denied"
                : "Only a pending install can be approved or denied",
          },
          { status: 400 },
        );
      }
    }

    if (nextStatus === "approved") {
      const amount = Math.round(Number(body.amountKes));
      if (!Number.isFinite(amount) || amount < 1) {
        return NextResponse.json(
          { error: "Enter the payment amount" },
          { status: 400 },
        );
      }
      const mpesaReference = String(body.mpesaReference ?? "")
        .replace(/\s+/g, "")
        .toUpperCase();
      if (!/^[A-Z0-9]{6,20}$/.test(mpesaReference)) {
        return NextResponse.json(
          { error: "Enter the M-Pesa reference code" },
          { status: 400 },
        );
      }

      update.installed_at = lead.installed_at ?? now;
      update.commission_earned_ksh = amount;
      update.mpesa_reference = mpesaReference;
      update.denial_reason = null;
      update.metadata = {
        ...prevMetadata,
        installCommission: {
          amountKes: amount,
          mpesaReference,
          confirmedAt: now,
          confirmedByAdminId: auth.user.id,
          proofReference:
            lead.product === "airtel"
              ? String(lead.airtel_sr_number ?? "").trim() || null
              : String(lead.safaricom_imei ?? "").trim() || null,
        },
      };
    }

    if (nextStatus === "denied") {
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 3) {
        return NextResponse.json(
          { error: "Enter a reason for denial" },
          { status: 400 },
        );
      }
      update.commission_earned_ksh = null;
      update.mpesa_reference = null;
      update.denial_reason = reason;
    }

    if (nextStatus === "pending_install") {
      update.commission_earned_ksh = null;
      update.installed_at = null;
      update.mpesa_reference = null;
      update.denial_reason = null;
    }

    if (
      nextStatus === "rejected" ||
      nextStatus === "duplicate" ||
      nextStatus === "cancelled" ||
      nextStatus === "lost" ||
      nextStatus === "needs_reassignment"
    ) {
      if (lead.status !== "installed" && lead.status !== "approved") {
        update.commission_earned_ksh = null;
        update.installed_at = null;
        update.mpesa_reference = null;
        update.denial_reason = null;
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

    const shouldNotify =
      (nextStatus === "approved" || nextStatus === "denied") &&
      Boolean(lead.assigned_agent_id);

    if (shouldNotify) {
      const amount = Number(update.commission_earned_ksh) || 0;
      const mpesa = String(update.mpesa_reference ?? "");
      const reason = String(update.denial_reason ?? "");
      try {
        const { data: notification, error: notifyError } = await service
          .from("notifications")
          .insert({
            agent_id: lead.assigned_agent_id,
            related_id: leadId,
            title: nextStatus === "approved" ? "Payment approved" : "Payment denied",
            message:
              nextStatus === "approved"
                ? `Payment for '${lead.customer_name}' is approved. You earned KSh ${amount}. M-Pesa ${mpesa}.`
                : `Payment for '${lead.customer_name}' was denied. ${reason}`,
            type: "LEAD_INSTALLED",
            is_read: false,
            metadata: {
              leadId,
              status: nextStatus,
              commissionKes: amount,
              mpesaReference: mpesa || null,
              reason: reason || null,
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
