/**
 * v1 agent matching: same county, product scope, availability, capacity.
 * Ranks by distance to lead town centroid.
 */

import {
  distanceKm,
  normalizeCountyKey,
  normalizeTownKey,
  type GeoPoint,
} from "./geo.ts";

export type LocationRef = {
  town_key: string;
  town_label: string;
  county: string;
  latitude: number;
  longitude: number;
};

export type AgentCandidate = {
  agent_id: string;
  county: string | null;
  town: string | null;
  lead_dispatch_scope: string;
  is_available: boolean;
  last_seen_at: string | null;
  is_fallback_agent?: boolean;
  fallback_priority?: number;
};

/** Agent opened the app recently (heartbeat), not merely "available" toggle. */
export function isAgentOnline(
  lastSeenAt: string | null | undefined,
  presenceMinutes: number,
): boolean {
  if (!lastSeenAt) return false;
  const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
  return elapsedMs >= 0 && elapsedMs <= presenceMinutes * 60 * 1000;
}

export type RankedAgent = AgentCandidate & {
  distance_km: number;
};

/** Whether agent's dispatch scope includes this product. */
export function agentAcceptsProduct(
  scope: string,
  product: "airtel" | "safaricom",
): boolean {
  if (scope === "none") return false;
  if (scope === "both") return true;
  return scope === product;
}

/**
 * Build lead geo point from town label + location_reference rows.
 * Falls back to null if town unknown (caller should route to admin_queue).
 */
export function resolveLeadPoint(
  installationTown: string,
  locationRefs: LocationRef[],
): { county: string; point: GeoPoint } | null {
  const key = normalizeTownKey(installationTown);
  const ref = locationRefs.find((r) => r.town_key === key);
  if (!ref) return null;
  return {
    county: ref.county,
    point: { latitude: ref.latitude, longitude: ref.longitude },
  };
}

export function resolveAgentPoint(
  town: string | null,
  locationRefs: LocationRef[],
): GeoPoint | null {
  if (!town) return null;
  const key = normalizeTownKey(town);
  const ref = locationRefs.find((r) => r.town_key === key);
  if (!ref) return null;
  return { latitude: ref.latitude, longitude: ref.longitude };
}

/** Rank eligible agents: online first (heartbeat), then offline-but-available, by distance. */
export function rankAgentsInCounty(
  leadCounty: string,
  leadPoint: GeoPoint,
  agents: AgentCandidate[],
  locationRefs: LocationRef[],
  product: "airtel" | "safaricom",
  openLeadCounts: Map<string, number>,
  maxOpenLeads: number,
  onlinePresenceMinutes: number = 5,
): RankedAgent[] {
  const ranked: RankedAgent[] = [];

  for (const agent of agents) {
    if (!agent.is_available) continue;
    if (normalizeCountyKey(agent.county) !== normalizeCountyKey(leadCounty)) {
      continue;
    }
    if (!agentAcceptsProduct(agent.lead_dispatch_scope, product)) continue;

    const open = openLeadCounts.get(agent.agent_id) ?? 0;
    if (open >= maxOpenLeads) continue;

    const agentPoint = resolveAgentPoint(agent.town, locationRefs);
    if (!agentPoint) continue;

    ranked.push({
      ...agent,
      distance_km: distanceKm(leadPoint, agentPoint),
    });
  }

  ranked.sort((a, b) => a.distance_km - b.distance_km);

  const online = ranked.filter((a) =>
    isAgentOnline(a.last_seen_at, onlinePresenceMinutes),
  );
  const offline = ranked.filter(
    (a) => !isAgentOnline(a.last_seen_at, onlinePresenceMinutes),
  );
  return [...online, ...offline];
}

/**
 * County-agnostic fallback agents (admin-designated).
 * Used when no county agent is available / all declined / town unknown —
 * before sending the lead to admin_queue.
 */
export function rankFallbackAgents(
  leadPoint: GeoPoint | null,
  agents: AgentCandidate[],
  locationRefs: LocationRef[],
  product: "airtel" | "safaricom",
  openLeadCounts: Map<string, number>,
  maxOpenLeads: number,
  onlinePresenceMinutes: number = 5,
): RankedAgent[] {
  const ranked: RankedAgent[] = [];

  for (const agent of agents) {
    if (!agent.is_fallback_agent) continue;
    if (!agent.is_available) continue;
    if (!agentAcceptsProduct(agent.lead_dispatch_scope, product)) continue;

    const open = openLeadCounts.get(agent.agent_id) ?? 0;
    if (open >= maxOpenLeads) continue;

    let distance_km = 99999;
    if (leadPoint) {
      const agentPoint = resolveAgentPoint(agent.town, locationRefs);
      if (agentPoint) {
        distance_km = distanceKm(leadPoint, agentPoint);
      }
    }

    ranked.push({
      ...agent,
      distance_km,
    });
  }

  ranked.sort((a, b) => {
    const priorityA = a.fallback_priority ?? 100;
    const priorityB = b.fallback_priority ?? 100;
    if (priorityA !== priorityB) return priorityA - priorityB;

    const aOnline = isAgentOnline(a.last_seen_at, onlinePresenceMinutes);
    const bOnline = isAgentOnline(b.last_seen_at, onlinePresenceMinutes);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;

    return a.distance_km - b.distance_km;
  });

  return ranked;
}

/** Blind preview payload — no customer name or phone. */
export function buildOfferPreview(
  product: "airtel" | "safaricom",
  county: string | null,
  installationTown: string | null,
  installationArea: string | null,
  deliveryLandmark: string | null,
  packageLabel: string | null,
  createdAt: string,
  distanceKm: number | null,
): Record<string, unknown> {
  const roughArea =
    installationArea?.trim() ||
    deliveryLandmark?.trim() ||
    null;

  const submittedMs = Date.now() - new Date(createdAt).getTime();
  const submittedAgoMinutes = Math.max(0, Math.floor(submittedMs / 60000));

  return {
    product,
    county,
    installationTown,
    roughArea,
    packageLabel,
    submittedAgoMinutes,
    distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
  };
}
