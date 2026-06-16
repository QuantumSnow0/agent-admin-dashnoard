import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/utils/super-admin";
import { submitRegistrationToMSForms } from "@/lib/super-admin-ms-forms";

export async function POST(request: Request) {
  try {
    await requireSuperAdmin();
  } catch (err: unknown) {
    const code = err instanceof Error ? err.message : "";
    if (code === "NOT_AUTHENTICATED") {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: "Super admin access required" },
      { status: 403 }
    );
  }

  let body: { registrationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const registrationId = body.registrationId?.trim();
  if (!registrationId) {
    return NextResponse.json(
      { success: false, error: "registrationId is required" },
      { status: 400 }
    );
  }

  try {
    const result = await submitRegistrationToMSForms(registrationId);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error ?? "Submission failed" },
        { status: 500 }
      );
    }
    return NextResponse.json({
      success: true,
      responseId: result.responseId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Submission failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
