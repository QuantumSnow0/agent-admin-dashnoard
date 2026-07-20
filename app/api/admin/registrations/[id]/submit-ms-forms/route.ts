import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { submitRegistrationToMSForms } from "@/lib/super-admin-ms-forms";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Fallback: admin submits an Airtel registration to Microsoft Forms.
 * On success, ms_forms_response_id is set and the order leaves the pending queue.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if ("error" in auth && auth.error) return auth.error;

  const { id } = await context.params;
  const registrationId = id?.trim();
  if (!registrationId) {
    return NextResponse.json(
      { success: false, error: "registrationId is required" },
      { status: 400 },
    );
  }

  try {
    const service = createServiceClient();
    const { data: row, error: lookupError } = await service
      .from("customer_registrations")
      .select("id, ms_forms_response_id")
      .eq("id", registrationId)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json(
        { success: false, error: lookupError.message },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Airtel registration not found" },
        { status: 404 },
      );
    }

    const result = await submitRegistrationToMSForms(registrationId);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error ?? "Submission failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      responseId: result.responseId,
      alreadySubmitted: Boolean(row.ms_forms_response_id),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Submission failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
