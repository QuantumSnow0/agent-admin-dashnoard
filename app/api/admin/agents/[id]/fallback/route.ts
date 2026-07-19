import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";

type Body = {
  is_fallback_agent?: boolean;
  fallback_priority?: number;
};

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

  if (typeof body.is_fallback_agent !== "boolean") {
    return NextResponse.json(
      { error: "is_fallback_agent (boolean) is required" },
      { status: 400 },
    );
  }

  const priority =
    body.fallback_priority != null
      ? Math.max(0, Math.min(9999, Math.round(Number(body.fallback_priority))))
      : undefined;

  if (body.fallback_priority != null && !Number.isFinite(priority)) {
    return NextResponse.json(
      { error: "fallback_priority must be a number" },
      { status: 400 },
    );
  }

  try {
    const service = createServiceClient();

    const update: Record<string, unknown> = {
      is_fallback_agent: body.is_fallback_agent,
    };
    if (priority != null) {
      update.fallback_priority = priority;
    }

    const { data: agent, error } = await service
      .from("agents")
      .update(update)
      .eq("id", agentId)
      .select("id, is_fallback_agent, fallback_priority")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      is_fallback_agent: agent.is_fallback_agent,
      fallback_priority: agent.fallback_priority,
    });
  } catch (err) {
    console.error("[admin/agents/fallback]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
