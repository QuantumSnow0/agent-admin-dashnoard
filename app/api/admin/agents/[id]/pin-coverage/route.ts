import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import {
  applyPeerUpdates,
  findCollisions,
  loadDefaultRadiusKm,
  loadPinCircles,
  loadZoneRows,
  parsePriority,
  parseRadiusKm,
  type PeerUpdate,
} from "@/lib/dispatch/coverage-admin";

type Body = {
  name?: string;
  placeId?: string | null;
  formattedAddress?: string | null;
  latitude?: number;
  longitude?: number;
  radius_km?: number;
  priority?: number;
  confirmCollisions?: boolean;
  peerUpdates?: PeerUpdate[];
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
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const radius_km = parseRadiusKm(body.radius_km);
  const priority = parsePriority(body.priority) ?? 100;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || radius_km == null) {
    return NextResponse.json({ error: "Drop a pin and set a radius" }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const { data: agent } = await service
      .from("agents")
      .select("id, working_place")
      .eq("id", agentId)
      .maybeSingle();
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const defaultRadiusKm = await loadDefaultRadiusKm(service);
    const [zones, pins] = await Promise.all([
      loadZoneRows(service, { inboundOnly: true }),
      loadPinCircles(service, defaultRadiusKm),
    ]);
    const collisions = findCollisions({
      draft: { latitude, longitude, radius_km },
      zones,
      pins,
      ignoreAgentId: agentId,
    });

    if (collisions.length > 0 && !body.confirmCollisions) {
      return NextResponse.json(
        { error: "This pin overlaps another agent. Set priorities to save.", collisions },
        { status: 409 },
      );
    }

    const existing =
      agent.working_place && typeof agent.working_place === "object"
        ? (agent.working_place as Record<string, unknown>)
        : {};
    const name = String(body.name ?? existing.name ?? "Working pin").trim() || "Working pin";
    const placeId =
      String(body.placeId ?? existing.placeId ?? "").trim() ||
      `dropped:${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    const now = new Date().toISOString();
    const place = {
      ...existing,
      placeId,
      name,
      formattedAddress: body.formattedAddress ?? existing.formattedAddress ?? "",
      lat: latitude,
      lng: longitude,
    };

    const { error: agentError } = await service
      .from("agents")
      .update({
        working_place: place,
        working_place_updated_at: now,
        updated_at: now,
      })
      .eq("id", agentId);
    if (agentError) {
      return NextResponse.json({ error: agentError.message }, { status: 500 });
    }

    const { error: settingsError } = await service.from("agent_dispatch_settings").upsert(
      {
        agent_id: agentId,
        service_radius_km: radius_km,
        pin_coverage_priority: priority,
        updated_at: now,
      },
      { onConflict: "agent_id" },
    );
    if (settingsError) {
      return NextResponse.json({ error: settingsError.message }, { status: 500 });
    }

    await applyPeerUpdates(service, body.peerUpdates ?? [], collisions);

    return NextResponse.json({
      success: true,
      pin: {
        agent_id: agentId,
        name,
        latitude,
        longitude,
        radius_km,
        priority,
      },
      collisions,
    });
  } catch (err) {
    console.error("[admin/agents/pin-coverage]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
