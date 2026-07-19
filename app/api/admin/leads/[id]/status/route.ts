import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { fetchAdminInboundLeadById } from "@/lib/admin-leads";
import { LEAD_INSTALL_COMMISSION_KES } from "@/lib/dispatch/constants";

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
      const commissionKes =
        Number(lead.commission_earned_ksh) > 0
          ? Number(lead.commission_earned_ksh)
          : LEAD_INSTALL_COMMISSION_KES;

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
      const amount =
        Number(update.commission_earned_ksh) || LEAD_INSTALL_COMMISSION_KES;
      try {
        await service.from("notifications").insert({
          agent_id: lead.assigned_agent_id,
          related_id: leadId,
          title: "Installation confirmed",
          message: `Admin confirmed install for ${lead.customer_name}. Commission KSh ${amount} will be paid with your next payout.`,
          type: "LEAD_INSTALLED",
          is_read: false,
          metadata: {
            leadId,
            commissionKes: amount,
            product: lead.product,
          },
        });
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
