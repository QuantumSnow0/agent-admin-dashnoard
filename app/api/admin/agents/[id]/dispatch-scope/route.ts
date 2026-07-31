import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { LEAD_DISPATCH_SCOPES } from "@/lib/dispatch/constants";
import { notifyAgentLeadsDispatchEnabled } from "@/lib/notifications/notify-leads-enabled";

type Body = { scope?: string };

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id: agentId } = await context.params;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scope = body.scope?.trim();
  if (!scope || !LEAD_DISPATCH_SCOPES.includes(scope as (typeof LEAD_DISPATCH_SCOPES)[number])) {
    return NextResponse.json({ error: "Invalid dispatch scope" }, { status: 400 });
  }

  try {
    const service = createServiceClient();

    const { data: before } = await service
      .from("agents")
      .select("id, lead_dispatch_scope, status")
      .eq("id", agentId)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const previousScope = before.lead_dispatch_scope ?? "none";

    const { data: agent, error } = await service
      .from("agents")
      .update({ lead_dispatch_scope: scope })
      .eq("id", agentId)
      .select("id, lead_dispatch_scope")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Turning dispatch off → pause availability so they leave the pool.
    if (scope === "none" && previousScope !== "none") {
      await service
        .from("agent_dispatch_settings")
        .upsert(
          {
            agent_id: agentId,
            is_available: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "agent_id" },
        );
    }

    // First-time (or re-)enable: nudge agent to turn on Receive leads.
    if (previousScope === "none" && scope !== "none") {
      await notifyAgentLeadsDispatchEnabled(service, agentId, scope);
    }

    return NextResponse.json({
      success: true,
      lead_dispatch_scope: agent.lead_dispatch_scope,
      notified: previousScope === "none" && scope !== "none",
    });
  } catch (err) {
    console.error("[admin/agents/dispatch-scope]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
