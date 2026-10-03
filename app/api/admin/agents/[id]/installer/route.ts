import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";

type Body = {
  installer?: boolean;
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

  if (typeof body.installer !== "boolean") {
    return NextResponse.json({ error: "installer (boolean) is required" }, { status: 400 });
  }

  try {
    const service = createServiceClient();

    const { data: agent, error } = await service
      .from("agents")
      .update({ is_installer: body.installer })
      .eq("id", agentId)
      .select("id, is_installer")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      is_installer: agent.is_installer,
    });
  } catch (err) {
    console.error("[admin/agents/installer]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
