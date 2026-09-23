import type { SupabaseClient } from "@supabase/supabase-js";
import { DISPATCH_DEFAULTS } from "@/lib/dispatch/constants";
import {
  circlesOverlapKm,
  clampServiceRadiusKm,
  effectiveRadiusKm,
  parsePreviewGooglePlace,
} from "@/lib/dispatch/matching";

export type CoverageZoneRow = {
  id: string;
  agent_id: string;
  agent_name: string;
  name: string;
  place_id: string | null;
  formatted_address: string | null;
  latitude: number;
  longitude: number;
  radius_km: number;
  priority: number;
};

export type PinCircle = {
  agent_id: string;
  agent_name: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  priority: number;
};

export type CoverageCollision = {
  kind: "zone" | "pin";
  agentId: string;
  agentName: string;
  zoneId: string | null;
  label: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  currentPriority: number;
};

export type DraftCircle = {
  latitude: number;
  longitude: number;
  radius_km: number;
};

export type PeerUpdate = {
  kind?: "zone" | "pin";
  agentId?: string;
  zoneId?: string | null;
  priority?: number;
};

export async function applyPeerUpdates(
  service: SupabaseClient,
  updates: PeerUpdate[],
  collisions: CoverageCollision[],
) {
  const allowed = new Set(
    collisions.map((c) => `${c.kind}:${c.agentId}:${c.zoneId ?? "pin"}`),
  );
  for (const update of updates) {
    const priority = parsePriority(update.priority);
    const agentId = String(update.agentId ?? "").trim();
    if (!priority || !agentId) continue;
    const kind = update.kind === "pin" ? "pin" : "zone";
    const zoneId = update.zoneId ?? null;
    if (!allowed.has(`${kind}:${agentId}:${zoneId ?? "pin"}`)) continue;

    if (kind === "pin") {
      await service.from("agent_dispatch_settings").upsert(
        {
          agent_id: agentId,
          pin_coverage_priority: priority,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "agent_id" },
      );
      continue;
    }
    if (!zoneId) continue;
    await service
      .from("agent_coverage_zones")
      .update({ priority, updated_at: new Date().toISOString() })
      .eq("id", zoneId)
      .eq("agent_id", agentId);
  }
}

export function parsePriority(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 1000) return null;
  return rounded;
}

export function parseRadiusKm(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampServiceRadiusKm(n);
}

export async function loadDefaultRadiusKm(service: SupabaseClient): Promise<number> {
  const { data } = await service
    .from("dispatch_config")
    .select("default_service_radius_km")
    .limit(1)
    .maybeSingle();
  const n = Number(data?.default_service_radius_km);
  return Number.isFinite(n) && n > 0 ? n : DISPATCH_DEFAULTS.defaultServiceRadiusKm;
}

function receivesInboundLeads(scope: unknown, status?: unknown): boolean {
  if (status != null && String(status) !== "approved") return false;
  const value = String(scope ?? "none");
  return value === "both" || value === "airtel" || value === "safaricom";
}

export async function loadZoneRows(
  service: SupabaseClient,
  options?: { inboundOnly?: boolean },
): Promise<CoverageZoneRow[]> {
  const { data: zones, error } = await service
    .from("agent_coverage_zones")
    .select("id, agent_id, name, place_id, formatted_address, latitude, longitude, radius_km, priority");
  if (error) throw error;

  const agentIds = [...new Set((zones ?? []).map((z) => String(z.agent_id)))];
  const names = new Map<string, string>();
  const inboundIds = new Set<string>();
  if (agentIds.length > 0) {
    const { data: agents } = await service
      .from("agents")
      .select("id, name, status, lead_dispatch_scope")
      .in("id", agentIds);
    for (const agent of agents ?? []) {
      const id = String(agent.id);
      names.set(id, String(agent.name ?? "Unnamed agent"));
      if (receivesInboundLeads(agent.lead_dispatch_scope, agent.status)) {
        inboundIds.add(id);
      }
    }
  }

  return (zones ?? [])
    .filter((zone) => !options?.inboundOnly || inboundIds.has(String(zone.agent_id)))
    .map((zone) => ({
      id: String(zone.id),
      agent_id: String(zone.agent_id),
      agent_name: names.get(String(zone.agent_id)) ?? "Unnamed agent",
      name: String(zone.name ?? ""),
      place_id: zone.place_id ? String(zone.place_id) : null,
      formatted_address: zone.formatted_address ? String(zone.formatted_address) : null,
      latitude: Number(zone.latitude),
      longitude: Number(zone.longitude),
      radius_km: Number(zone.radius_km),
      priority: Number(zone.priority ?? 1),
    }));
}

export async function loadPinCircles(
  service: SupabaseClient,
  defaultRadiusKm: number,
): Promise<PinCircle[]> {
  const { data: zoned } = await service.from("agent_coverage_zones").select("agent_id");
  const zonedIds = new Set((zoned ?? []).map((row) => String(row.agent_id)));

  const { data: agents } = await service
    .from("agents")
    .select("id, name, working_place, status, lead_dispatch_scope")
    .eq("status", "approved");

  const ids = (agents ?? []).map((a) => String(a.id)).filter((id) => !zonedIds.has(id));
  if (ids.length === 0) return [];

  const { data: settings } = await service
    .from("agent_dispatch_settings")
    .select("agent_id, service_radius_km, pin_coverage_priority")
    .in("agent_id", ids);
  const settingsMap = new Map((settings ?? []).map((s) => [String(s.agent_id), s]));

  const pins: PinCircle[] = [];
  for (const agent of agents ?? []) {
    const id = String(agent.id);
    if (zonedIds.has(id)) continue;
    if (!receivesInboundLeads(agent.lead_dispatch_scope, agent.status)) continue;
    const place = parsePreviewGooglePlace(agent.working_place);
    if (!place) continue;
    const setting = settingsMap.get(id);
    pins.push({
      agent_id: id,
      agent_name: String(agent.name ?? "Unnamed agent"),
      name: place.name,
      latitude: place.lat,
      longitude: place.lng,
      radius_km: effectiveRadiusKm(
        { service_radius_km: setting?.service_radius_km != null ? Number(setting.service_radius_km) : null },
        defaultRadiusKm,
      ),
      priority: Number(setting?.pin_coverage_priority) || DISPATCH_DEFAULTS.pinCoveragePriority,
    });
  }
  return pins;
}

export function findCollisions(args: {
  draft: DraftCircle;
  zones: CoverageZoneRow[];
  pins: PinCircle[];
  ignoreZoneId?: string | null;
  ignoreAgentId?: string | null;
}): CoverageCollision[] {
  const collisions: CoverageCollision[] = [];

  for (const zone of args.zones) {
    if (args.ignoreZoneId && zone.id === args.ignoreZoneId) continue;
    if (args.ignoreAgentId && zone.agent_id === args.ignoreAgentId) continue;
    if (
      !circlesOverlapKm(
        {
          latitude: args.draft.latitude,
          longitude: args.draft.longitude,
          radius_km: args.draft.radius_km,
        },
        {
          latitude: zone.latitude,
          longitude: zone.longitude,
          radius_km: zone.radius_km,
        },
      )
    ) {
      continue;
    }
    collisions.push({
      kind: "zone",
      agentId: zone.agent_id,
      agentName: zone.agent_name,
      zoneId: zone.id,
      label: zone.name || "Coverage zone",
      latitude: zone.latitude,
      longitude: zone.longitude,
      radiusKm: zone.radius_km,
      currentPriority: zone.priority,
    });
  }

  for (const pin of args.pins) {
    if (args.ignoreAgentId && pin.agent_id === args.ignoreAgentId) continue;
    if (
      !circlesOverlapKm(
        {
          latitude: args.draft.latitude,
          longitude: args.draft.longitude,
          radius_km: args.draft.radius_km,
        },
        {
          latitude: pin.latitude,
          longitude: pin.longitude,
          radius_km: pin.radius_km,
        },
      )
    ) {
      continue;
    }
    collisions.push({
      kind: "pin",
      agentId: pin.agent_id,
      agentName: pin.agent_name,
      zoneId: null,
      label: `${pin.name} (working pin)`,
      latitude: pin.latitude,
      longitude: pin.longitude,
      radiusKm: pin.radius_km,
      currentPriority: pin.priority,
    });
  }

  return collisions;
}
