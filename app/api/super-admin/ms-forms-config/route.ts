import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/utils/super-admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  fetchMSFormsSubmissionMode,
  updateMSFormsSubmissionMode,
  type MSFormsSubmissionMode,
} from "@/lib/ms-forms-config";

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (err: unknown) {
    const code = err instanceof Error ? err.message : "";
    if (code === "NOT_AUTHENTICATED") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "Super admin access required" }, { status: 403 });
  }

  const service = createServiceClient();
  const submissionMode = await fetchMSFormsSubmissionMode(service);
  return NextResponse.json({ submissionMode });
}

export async function PATCH(request: Request) {
  try {
    await requireSuperAdmin();
  } catch (err: unknown) {
    const code = err instanceof Error ? err.message : "";
    if (code === "NOT_AUTHENTICATED") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "Super admin access required" }, { status: 403 });
  }

  let body: { submissionMode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const mode = body.submissionMode;
  if (mode !== "auto" && mode !== "manual") {
    return NextResponse.json(
      { error: "submissionMode must be 'auto' or 'manual'" },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const result = await updateMSFormsSubmissionMode(
    service,
    mode as MSFormsSubmissionMode
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ submissionMode: mode });
}
