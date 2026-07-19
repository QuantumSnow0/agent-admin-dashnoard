import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { offerLeadToAgent } from "@/lib/dispatch/dispatch-service";

type Body = { agentId?: string };

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id: leadId } = await context.params;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const agentId = body.agentId?.trim();
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const result = await offerLeadToAgent(service, leadId, agentId);

    if (result.outcome === "error") {
      const messages: Record<string, string> = {
        lead_not_found: "Lead not found",
        agent_not_found: "Agent not found",
        agent_not_approved: "Agent must be approved",
        agent_scope_mismatch: "Agent cannot receive this product",
        agent_scope_none: "Agent is not enabled for inbound leads",
        unknown_county: "Lead county could not be resolved",
      };
      const message =
        messages[result.reason] ??
        `Could not send offer (${result.reason})`;
      const status = result.reason === "lead_not_found" ? 404 : 400;
      return NextResponse.json({ error: message }, { status });
    }

    const { data: agent } = await service
      .from("agents")
      .select("name")
      .eq("id", agentId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      leadId,
      agentId,
      agentName: agent?.name ?? null,
      offerId: result.offerId,
      offered: true,
    });
  } catch (err) {
    console.error("[admin/leads/assign]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
