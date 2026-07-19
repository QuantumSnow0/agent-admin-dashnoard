import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import {
  fetchAdminInboundLeads,
  fetchLeadTabCounts,
} from "@/lib/admin-leads";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status") || "queue";
  const searchQuery = (searchParams.get("q") ?? "").trim();

  try {
    const service = createServiceClient();
    const [leadsResult, counts] = await Promise.all([
      fetchAdminInboundLeads(service, { statusFilter, searchQuery }),
      fetchLeadTabCounts(service),
    ]);

    if (leadsResult.error) {
      return NextResponse.json({ error: leadsResult.error }, { status: 500 });
    }

    return NextResponse.json({
      leads: leadsResult.leads,
      counts,
    });
  } catch (err) {
    console.error("[admin/leads GET]", err);
    return NextResponse.json({ error: "Failed to load leads" }, { status: 500 });
  }
}
