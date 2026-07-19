import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { LEAD_DISPATCH_SCOPES } from "@/lib/dispatch/constants";

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

    return NextResponse.json({ success: true, lead_dispatch_scope: agent.lead_dispatch_scope });
  } catch (err) {
    console.error("[admin/agents/dispatch-scope]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
