import { DISPATCH_DEFAULTS } from "./constants.ts";
import {
  distanceKm,
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
  name?: string | null;
  county: string | null;
  town: string | null;
  lead_dispatch_scope: string;
  is_available: boolean;
  last_seen_at: string | null;
  is_fallback_agent?: boolean;
  fallback_priority?: number;
  working_place?: unknown;
  service_radius_km?: number | null;
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
  radius_km: number;
};

export function agentAcceptsProduct(
  scope: string,
  product: "airtel" | "safaricom",
): boolean {
  if (scope === "none") return false;
  if (scope === "both") return true;
  return scope === product;
}

export function roundKm(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clampServiceRadiusKm(value: number): number {
  return Math.min(
    DISPATCH_DEFAULTS.maxServiceRadiusKm,
    Math.max(DISPATCH_DEFAULTS.minServiceRadiusKm, value),
  );
}

export function effectiveRadiusKm(
  agent: Pick<AgentCandidate, "service_radius_km">,
  defaultRadiusKm: number,
): number {
  const override = Number(agent.service_radius_km);
  if (Number.isFinite(override) && override > 0) {
    return clampServiceRadiusKm(override);
  }
  return clampServiceRadiusKm(defaultRadiusKm);
}

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

export function resolveAgentPin(workingPlace: unknown): GeoPoint | null {
  const place = parsePreviewGooglePlace(workingPlace);
  if (!place) return null;
  return { latitude: place.lat, longitude: place.lng };
}

export function resolveCustomerPoint(
  metadata: unknown,
  installationTown: string,
  locationRefs: LocationRef[],
): { county: string | null; point: GeoPoint; source: "pin" | "town" } | null {
  const pin = googlePlaceFromLeadMetadata(metadata);
  if (pin) {
    return {
      county: pin.county ?? null,
      point: { latitude: pin.lat, longitude: pin.lng },
      source: "pin",
    };
  }
  const town = resolveLeadPoint(installationTown, locationRefs);
  if (!town) return null;
  return { county: town.county, point: town.point, source: "town" };
}

function pinDistanceKm(
  leadPoint: GeoPoint,
  workingPlace: unknown,
): number | null {
  const agentPoint = resolveAgentPin(workingPlace);
  if (!agentPoint) return null;
  return roundKm(distanceKm(leadPoint, agentPoint));
}

function sortOnlineThenDistance(
  agents: RankedAgent[],
  onlinePresenceMinutes: number,
): RankedAgent[] {
  const online = agents.filter((a) =>
    isAgentOnline(a.last_seen_at, onlinePresenceMinutes),
  );
  const offline = agents.filter(
    (a) => !isAgentOnline(a.last_seen_at, onlinePresenceMinutes),
  );
  online.sort((a, b) => a.distance_km - b.distance_km);
  offline.sort((a, b) => a.distance_km - b.distance_km);
  return [...online, ...offline];
}

function passesCapacity(
  agentId: string,
  openLeadCounts: Map<string, number>,
  maxOpenLeads: number | null,
): boolean {
  if (maxOpenLeads == null) return true;
  return (openLeadCounts.get(agentId) ?? 0) < maxOpenLeads;
}

/**
 * Rank agents whose working pin is within their effective radius of the
 * customer pin. County is not a gate. Bigger radius does not beat nearer.
 */
export function rankAgentsInRange(
  leadPoint: GeoPoint,
  agents: AgentCandidate[],
  product: "airtel" | "safaricom",
  openLeadCounts: Map<string, number>,
  maxOpenLeads: number | null,
  onlinePresenceMinutes: number,
  defaultRadiusKm: number,
): RankedAgent[] {
  const ranked: RankedAgent[] = [];

  for (const agent of agents) {
    if (!agent.is_available) continue;
    if (!agentAcceptsProduct(agent.lead_dispatch_scope, product)) continue;
    if (!passesCapacity(agent.agent_id, openLeadCounts, maxOpenLeads)) continue;

    const distance = pinDistanceKm(leadPoint, agent.working_place);
    if (distance == null) continue;

    const radius_km = effectiveRadiusKm(agent, defaultRadiusKm);
    if (distance > radius_km) continue;

    ranked.push({
      ...agent,
      distance_km: distance,
      radius_km,
    });
  }

  return sortOnlineThenDistance(ranked, onlinePresenceMinutes);
}

/** @deprecated Use rankAgentsInRange. Kept so older call sites compile during rollout. */
export function rankAgentsInCounty(
  _leadCounty: string,
  leadPoint: GeoPoint,
  agents: AgentCandidate[],
  _locationRefs: LocationRef[],
  product: "airtel" | "safaricom",
  openLeadCounts: Map<string, number>,
  maxOpenLeads: number | null,
  onlinePresenceMinutes: number = 5,
  defaultRadiusKm: number = DISPATCH_DEFAULTS.defaultServiceRadiusKm,
): RankedAgent[] {
  return rankAgentsInRange(
    leadPoint,
    agents,
    product,
    openLeadCounts,
    maxOpenLeads,
    onlinePresenceMinutes,
    defaultRadiusKm,
  );
}

/**
 * Designated fallback agents — not limited by the normal radius.
 * Used when nobody is in range, then admin queue.
 */
export function rankFallbackAgents(
  leadPoint: GeoPoint | null,
  agents: AgentCandidate[],
  _locationRefs: LocationRef[],
  product: "airtel" | "safaricom",
  openLeadCounts: Map<string, number>,
  maxOpenLeads: number | null,
  onlinePresenceMinutes: number = 5,
  defaultRadiusKm: number = DISPATCH_DEFAULTS.defaultServiceRadiusKm,
): RankedAgent[] {
  const ranked: RankedAgent[] = [];

  for (const agent of agents) {
    if (!agent.is_fallback_agent) continue;
    if (!agent.is_available) continue;
    if (!agentAcceptsProduct(agent.lead_dispatch_scope, product)) continue;
    if (!passesCapacity(agent.agent_id, openLeadCounts, maxOpenLeads)) continue;

    const radius_km = effectiveRadiusKm(agent, defaultRadiusKm);
    let distance_km = 99999;
    if (leadPoint) {
      const pinKm = pinDistanceKm(leadPoint, agent.working_place);
      if (pinKm != null) distance_km = pinKm;
    }

    ranked.push({
      ...agent,
      distance_km,
      radius_km,
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

export type DispatchMatchAgentRow = {
  agentId: string;
  name: string | null;
  workingPlaceName: string | null;
  distanceKm: number | null;
  radiusKm: number;
  inRadius: boolean;
  reason: "in_range" | "out_of_radius" | "no_pin";
};

export type DispatchMatchSnapshot = {
  at: string;
  reason: string;
  customerPin: {
    name: string;
    formattedAddress: string;
    lat: number;
    lng: number;
  } | null;
  defaultRadiusKm: number;
  nearestInRange: DispatchMatchAgentRow[];
  outOfRadius: DispatchMatchAgentRow[];
  noPin: DispatchMatchAgentRow[];
};

function toMatchRow(
  agent: AgentCandidate,
  distanceKmValue: number | null,
  radiusKm: number,
  reason: DispatchMatchAgentRow["reason"],
): DispatchMatchAgentRow {
  return {
    agentId: agent.agent_id,
    name: agent.name ?? null,
    workingPlaceName: parsePreviewGooglePlace(agent.working_place)?.name ?? null,
    distanceKm: distanceKmValue,
    radiusKm,
    inRadius: reason === "in_range",
    reason,
  };
}

export function inspectPinMatch(
  leadPoint: GeoPoint,
  agents: AgentCandidate[],
  product: "airtel" | "safaricom",
  defaultRadiusKm: number,
): {
  inRange: DispatchMatchAgentRow[];
  outOfRadius: DispatchMatchAgentRow[];
  noPin: DispatchMatchAgentRow[];
} {
  const inRange: DispatchMatchAgentRow[] = [];
  const outOfRadius: DispatchMatchAgentRow[] = [];
  const noPin: DispatchMatchAgentRow[] = [];

  for (const agent of agents) {
    if (!agentAcceptsProduct(agent.lead_dispatch_scope, product)) continue;
    const radiusKm = effectiveRadiusKm(agent, defaultRadiusKm);
    const distance = pinDistanceKm(leadPoint, agent.working_place);
    if (distance == null) {
      noPin.push(toMatchRow(agent, null, radiusKm, "no_pin"));
      continue;
    }
    if (distance <= radiusKm) {
      inRange.push(toMatchRow(agent, distance, radiusKm, "in_range"));
    } else {
      outOfRadius.push(toMatchRow(agent, distance, radiusKm, "out_of_radius"));
    }
  }

  inRange.sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999));
  outOfRadius.sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999));
  return { inRange, outOfRadius, noPin };
}

export function buildDispatchMatchSnapshot(args: {
  reason: string;
  metadata: unknown;
  leadPoint: GeoPoint | null;
  agents: AgentCandidate[];
  product: "airtel" | "safaricom";
  defaultRadiusKm: number;
}): DispatchMatchSnapshot {
  const customer = googlePlaceFromLeadMetadata(args.metadata);
  const inspected = args.leadPoint
    ? inspectPinMatch(
        args.leadPoint,
        args.agents,
        args.product,
        args.defaultRadiusKm,
      )
    : { inRange: [], outOfRadius: [], noPin: [] };

  return {
    at: new Date().toISOString(),
    reason: args.reason,
    customerPin: customer
      ? {
          name: customer.name,
          formattedAddress: customer.formattedAddress,
          lat: customer.lat,
          lng: customer.lng,
        }
      : null,
    defaultRadiusKm: args.defaultRadiusKm,
    nearestInRange: inspected.inRange.slice(0, 8),
    outOfRadius: inspected.outOfRadius.slice(0, 8),
    noPin: inspected.noPin.slice(0, 8),
  };
}

export function buildOfferPreview(
  product: "airtel" | "safaricom",
  county: string | null,
  installationTown: string | null,
  installationArea: string | null,
  deliveryLandmark: string | null,
  packageLabel: string | null,
  createdAt: string,
  distanceKmValue: number | null,
  extras?: { isCallbackReminder?: boolean; googlePlace?: PreviewGooglePlace | null },
): Record<string, unknown> {
  const googlePlace = extras?.googlePlace ?? null;
  const roughArea =
    googlePlace?.name?.trim() ||
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
    distanceKm:
      distanceKmValue != null ? roundKm(distanceKmValue) : null,
    googlePlace,
    ...(extras?.isCallbackReminder ? { isCallbackReminder: true } : {}),
  };
}

export type PreviewGooglePlace = {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  county?: string | null;
};

export function parsePreviewGooglePlace(raw: unknown): PreviewGooglePlace | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const placeId = String(value.placeId ?? "").trim();
  const name = String(value.name ?? "").trim();
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!placeId || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return {
    placeId,
    name,
    formattedAddress: String(value.formattedAddress ?? "").trim(),
    lat,
    lng,
    county: value.county ? String(value.county) : null,
  };
}

export function googlePlaceFromLeadMetadata(
  metadata: unknown,
): PreviewGooglePlace | null {
  if (!metadata || typeof metadata !== "object") return null;
  return parsePreviewGooglePlace(
    (metadata as Record<string, unknown>).googlePlace,
  );
}

export function pinDistanceFromPlaces(
  customer: PreviewGooglePlace | null,
  agentWorkingPlace: unknown,
): number | null {
  const agent = parsePreviewGooglePlace(agentWorkingPlace);
  if (!customer || !agent) return null;
  return roundKm(
    distanceKm(
      { latitude: customer.lat, longitude: customer.lng },
      { latitude: agent.lat, longitude: agent.lng },
    ),
  );
}

export function parseDispatchMatchSnapshot(
  metadata: unknown,
): DispatchMatchSnapshot | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).dispatchMatch;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as DispatchMatchSnapshot;
  if (!Array.isArray(value.nearestInRange) || !Array.isArray(value.outOfRadius)) {
    return null;
  }
  return value;
}
