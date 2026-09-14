import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { notifyAgentAirtelConnectOpened } from "@/lib/notifications/notify-airtel-connect-opened";

type Body = {
  opened?: boolean;
  /** When marking opened, send in-app + push instructions (default true). */
  notify?: boolean;
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

  if (typeof body.opened !== "boolean") {
    return NextResponse.json({ error: "opened (boolean) is required" }, { status: 400 });
  }

  const shouldNotify = body.notify !== false;

  try {
    const service = createServiceClient();

    const { data: before } = await service
      .from("agents")
      .select("id, name, airtel_connect_opened")
      .eq("id", agentId)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const update = body.opened
      ? {
          airtel_connect_opened: true,
          airtel_connect_opened_at: now,
        }
      : {
          airtel_connect_opened: false,
          airtel_connect_opened_at: null,
        };

    const { data: agent, error } = await service
      .from("agents")
      .update(update)
      .eq("id", agentId)
      .select("id, airtel_connect_opened, airtel_connect_opened_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    let notified = false;
    if (
      body.opened &&
      shouldNotify &&
      before.airtel_connect_opened !== true
    ) {
      const result = await notifyAgentAirtelConnectOpened(
        service,
        agentId,
        before.name,
      );
      notified = result.notified;
    }

    return NextResponse.json({
      success: true,
      airtel_connect_opened: agent.airtel_connect_opened,
      airtel_connect_opened_at: agent.airtel_connect_opened_at,
      notified,
    });
  } catch (err) {
    console.error("[admin/agents/airtel-connect]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
