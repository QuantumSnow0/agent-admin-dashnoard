import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { submitInboundLeadToMSForms } from "@/lib/super-admin-ms-forms";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAdminInboundLeadById } from "@/lib/admin-leads";

/**
 * Admin fallback: submit an inbound Airtel lead to Microsoft Forms.
 * Works for any lead status (assigned, kyc_completed, queue, etc.).
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id: leadId } = await context.params;
  if (!leadId?.trim()) {
    return NextResponse.json(
      { success: false, error: "leadId is required" },
      { status: 400 },
    );
  }

  try {
    const service = createServiceClient();
    const { data: row, error: lookupError } = await service
      .from("inbound_leads")
      .select("id, product, ms_forms_response_id")
      .eq("id", leadId)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json(
        { success: false, error: lookupError.message },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Lead not found" },
        { status: 404 },
      );
    }
    if (row.product !== "airtel") {
      return NextResponse.json(
        { success: false, error: "Only Airtel leads can be submitted to MS Forms" },
        { status: 400 },
      );
    }

    const result = await submitInboundLeadToMSForms(leadId);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error ?? "Submission failed" },
        { status: 500 },
      );
    }

    const { lead } = await fetchAdminInboundLeadById(service, leadId);

    return NextResponse.json({
      success: true,
      responseId: result.responseId,
      alreadySubmitted: Boolean(
        result.alreadySubmitted ?? row.ms_forms_response_id,
      ),
      lead,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Submission failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
