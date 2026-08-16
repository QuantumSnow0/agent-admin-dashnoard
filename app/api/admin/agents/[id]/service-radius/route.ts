import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { clampServiceRadiusKm } from "@/lib/dispatch/matching";

type Body = { service_radius_km?: number | string | null };

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

  let radius: number | null = null;
  if (body.service_radius_km != null && String(body.service_radius_km).trim() !== "") {
    const raw = Number(body.service_radius_km);
    if (!Number.isFinite(raw) || raw <= 0) {
      return NextResponse.json(
        { error: "Enter a radius between 0.5 and 50 km, or clear it to use the default" },
        { status: 400 },
      );
    }
    radius = clampServiceRadiusKm(raw);
  }

  try {
    const service = createServiceClient();
    const { data: agent } = await service
      .from("agents")
      .select("id")
      .eq("id", agentId)
      .maybeSingle();
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const { error } = await service.from("agent_dispatch_settings").upsert(
      {
        agent_id: agentId,
        service_radius_km: radius,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agent_id" },
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      service_radius_km: radius,
    });
  } catch (err) {
    console.error("[admin/agents/service-radius]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
