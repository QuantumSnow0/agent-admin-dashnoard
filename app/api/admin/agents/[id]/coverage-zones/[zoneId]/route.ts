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
  context: { params: Promise<{ id: string; zoneId: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id: agentId, zoneId } = await context.params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const { data: existing } = await service
      .from("agent_coverage_zones")
      .select("id, agent_id, name, place_id, formatted_address, latitude, longitude, radius_km, priority")
      .eq("id", zoneId)
      .eq("agent_id", agentId)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Zone not found" }, { status: 404 });
    }

    const latitude = body.latitude != null ? Number(body.latitude) : Number(existing.latitude);
    const longitude = body.longitude != null ? Number(body.longitude) : Number(existing.longitude);
    const radius_km = body.radius_km != null ? parseRadiusKm(body.radius_km) : Number(existing.radius_km);
    const priority = body.priority != null ? parsePriority(body.priority) : Number(existing.priority);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || radius_km == null || priority == null) {
      return NextResponse.json({ error: "Invalid pin, radius, or priority" }, { status: 400 });
    }

    const defaultRadiusKm = await loadDefaultRadiusKm(service);
    const [zones, pins] = await Promise.all([
      loadZoneRows(service, { inboundOnly: true }),
      loadPinCircles(service, defaultRadiusKm),
    ]);
    const collisions = findCollisions({
      draft: { latitude, longitude, radius_km },
      zones,
      pins,
      ignoreZoneId: zoneId,
      ignoreAgentId: agentId,
    });

    if (collisions.length > 0 && !body.confirmCollisions) {
      return NextResponse.json(
        { error: "This zone overlaps another agent. Set priorities to save.", collisions },
        { status: 409 },
      );
    }

    const { data: updated, error } = await service
      .from("agent_coverage_zones")
      .update({
        name: body.name != null ? String(body.name).trim() || existing.name : existing.name,
        place_id: body.placeId !== undefined ? body.placeId : existing.place_id,
        formatted_address:
          body.formattedAddress !== undefined ? body.formattedAddress : existing.formatted_address,
        latitude,
        longitude,
        radius_km,
        priority,
        updated_at: new Date().toISOString(),
      })
      .eq("id", zoneId)
      .select("id, agent_id, name, place_id, formatted_address, latitude, longitude, radius_km, priority")
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: error?.message ?? "Failed to update zone" }, { status: 500 });
    }

    await applyPeerUpdates(service, body.peerUpdates ?? [], collisions);

    return NextResponse.json({ success: true, zone: updated, collisions });
  } catch (err) {
    console.error("[admin/coverage-zones/id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; zoneId: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id: agentId, zoneId } = await context.params;
  try {
    const service = createServiceClient();
    const { error } = await service
      .from("agent_coverage_zones")
      .delete()
      .eq("id", zoneId)
      .eq("agent_id", agentId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[admin/coverage-zones/delete]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
