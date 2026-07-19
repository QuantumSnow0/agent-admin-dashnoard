import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { LEAD_QUEUE_STATUSES } from "@/lib/admin-leads";
import { dispatchLead } from "@/lib/dispatch/dispatch-service";

const RETRY_STATUSES = [...LEAD_QUEUE_STATUSES];

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id: leadId } = await context.params;

  try {
    const service = createServiceClient();

    const { data: lead, error: leadError } = await service
      .from("inbound_leads")
      .select("id, status")
      .eq("id", leadId)
      .maybeSingle();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (!RETRY_STATUSES.includes(lead.status as (typeof RETRY_STATUSES)[number])) {
      return NextResponse.json(
        { error: `Cannot retry dispatch for status: ${lead.status}` },
        { status: 400 },
      );
    }

    if (lead.status === "admin_queue") {
      const { error: updateError } = await service
        .from("inbound_leads")
        .update({ status: "pending_dispatch" })
        .eq("id", leadId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    const result = await dispatchLead(service, leadId);
    return NextResponse.json({ success: true, dispatch: result });
  } catch (err) {
    console.error("[admin/leads/retry-dispatch]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
