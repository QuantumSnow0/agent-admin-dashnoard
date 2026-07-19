import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { fetchAdminInboundLeadById } from "@/lib/admin-leads";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id } = await context.params;

  try {
    const service = createServiceClient();
    const { lead, error } = await fetchAdminInboundLeadById(service, id);

    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({ lead });
  } catch (err) {
    console.error("[admin/leads/[id] GET]", err);
    return NextResponse.json({ error: "Failed to load lead" }, { status: 500 });
  }
}
