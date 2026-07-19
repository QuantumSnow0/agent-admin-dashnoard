import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { fetchAssignableAgents } from "@/lib/admin-leads";

export async function GET(
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
      .select("id, product, county")
      .eq("id", leadId)
      .maybeSingle();

    if (leadError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const agents = await fetchAssignableAgents(service, lead);
    const sorted = [
      ...agents.filter((a) => a.scope_match && a.county_match),
      ...agents.filter((a) => a.scope_match && !a.county_match),
      ...agents.filter((a) => !a.scope_match),
    ];

    return NextResponse.json({ agents: sorted });
  } catch (err) {
    console.error("[admin/leads/assignable-agents]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
