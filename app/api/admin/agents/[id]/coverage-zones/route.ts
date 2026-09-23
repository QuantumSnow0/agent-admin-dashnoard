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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id: agentId } = await context.params;
  const service = createServiceClient();
  const zones = (await loadZoneRows(service)).filter((z) => z.agent_id === agentId);
  return NextResponse.json({ zones });
}

export async function POST(
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

  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  const radius = parseRadiusKm(body.radius_km);
  const priority = parsePriority(body.priority) ?? 1;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || radius == null) {
    return NextResponse.json({ error: "Drop a pin and set a radius" }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const { data: agent } = await service
      .from("agents")
      .select("id, name")
      .eq("id", agentId)
      .maybeSingle();
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    const defaultRadiusKm = await loadDefaultRadiusKm(service);
    const [zones, pins] = await Promise.all([
      loadZoneRows(service, { inboundOnly: true }),
      loadPinCircles(service, defaultRadiusKm),
    ]);
    const collisions = findCollisions({
      draft: { latitude: lat, longitude: lng, radius_km: radius },
      zones,
      pins,
      ignoreAgentId: agentId,
    });

    if (collisions.length > 0 && !body.confirmCollisions) {
      return NextResponse.json(
        { error: "This zone overlaps another agent. Set priorities to save.", collisions },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const { data: created, error } = await service
      .from("agent_coverage_zones")
      .insert({
        agent_id: agentId,
        name: String(body.name ?? "").trim() || "Coverage zone",
        place_id: body.placeId ?? null,
        formatted_address: body.formattedAddress ?? null,
        latitude: lat,
        longitude: lng,
        radius_km: radius,
        priority,
        updated_at: now,
      })
      .select("id, agent_id, name, place_id, formatted_address, latitude, longitude, radius_km, priority")
      .single();

    if (error || !created) {
      return NextResponse.json({ error: error?.message ?? "Failed to save zone" }, { status: 500 });
    }

    await applyPeerUpdates(service, body.peerUpdates ?? [], collisions);

    return NextResponse.json({ success: true, zone: created, collisions });
  } catch (err) {
    console.error("[admin/coverage-zones]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
