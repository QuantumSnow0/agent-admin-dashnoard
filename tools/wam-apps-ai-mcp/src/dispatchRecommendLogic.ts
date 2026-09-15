/**
 * Pure helpers mirroring wam_ai.recommend_agents_for_lead ranking semantics for unit tests.
 * Source of truth remains SQL; keep in sync when changing migration scoring.
 */

export type GeoPoint = { lat: number; lng: number };

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function effectiveRadiusKm(
  agentOverride: number | null | undefined,
  defaultRadius: number,
): number {
  const override = Number(agentOverride);
  if (Number.isFinite(override) && override > 0) {
    return Math.min(50, Math.max(0.5, override));
  }
  return Math.min(50, Math.max(0.5, defaultRadius));
}

export type GeographicPracticality =
  | "inside_normal_radius"
  | "outside_normal_radius_but_recommended"
  | "outside_normal_radius_alternative"
  | "operationally_impractical"
  | "distance_unverified";

export function geographicPracticalityLabel(input: {
  leadVerified: boolean;
  agentVerified: boolean;
  distanceKm: number | null;
  effectiveRadiusKm: number;
  closerEligibleCount: number;
  minCloserDistanceKm: number | null;
  isTopRecommendation: boolean;
}): GeographicPracticality {
  const {
    leadVerified,
    agentVerified,
    distanceKm,
    effectiveRadiusKm: radius,
    closerEligibleCount,
    minCloserDistanceKm,
    isTopRecommendation,
  } = input;
  if (!leadVerified || !agentVerified || distanceKm == null) {
    return "distance_unverified";
  }
  if (distanceKm <= radius) return "inside_normal_radius";
  if (
    closerEligibleCount > 0 &&
    minCloserDistanceKm != null &&
    distanceKm > minCloserDistanceKm * 2 + radius
  ) {
    return "operationally_impractical";
  }
  if (isTopRecommendation) return "outside_normal_radius_but_recommended";
  return "outside_normal_radius_alternative";
}

export function urgencyDistanceRelief(
  leadUrgency: "normal" | "moderate" | "elevated" | "high",
): number {
  switch (leadUrgency) {
    case "high":
      return 0.45;
    case "elevated":
      return 0.25;
    case "moderate":
      return 0.1;
    default:
      return 0;
  }
}

/** Balanced score excludes lead urgency (uniform shifts do not change relative order). */
export function balancedBusinessScore(input: {
  distanceKm: number | null;
  effectiveRadiusKm: number;
  online: boolean;
  available: boolean;
  openDispatchLeads: number;
  activeOffers: number;
  recentInstalls: number | null;
  recentAccepted: number | null;
}): number {
  const distancePenalty =
    input.distanceKm == null
      ? 75
      : Math.max(0, input.distanceKm - input.effectiveRadiusKm) * 1.5;
  return (
    distancePenalty +
    (input.online ? 0 : 12) +
    (input.available ? 0 : 50) +
    input.openDispatchLeads * 8 +
    input.activeOffers * 4 -
    Math.min(input.recentInstalls ?? 0, 5) * 2 -
    Math.min(input.recentAccepted ?? 0, 5) +
    (input.distanceKm != null && input.distanceKm > input.effectiveRadiusKm ? -5 : 0)
  );
}

/** Recommendation-rank sort key: urgency interacts with per-agent distance evidence. */
export function recommendationRankScore(input: {
  balancedScore: number;
  distanceKm: number | null;
  effectiveRadiusKm: number;
  leadUrgency: "normal" | "moderate" | "elevated" | "high";
  geographicPracticality: GeographicPracticality;
}): number {
  const inside =
    input.distanceKm != null && input.distanceKm <= input.effectiveRadiusKm;
  const relief = urgencyDistanceRelief(input.leadUrgency);
  const expansionPenalty =
    input.distanceKm == null || inside
      ? 0
      : Math.max(0, input.distanceKm - input.effectiveRadiusKm) * 1.5;
  const distanceSortBonus = input.distanceKm == null ? 25 : inside ? -5 : 0;
  const urgencyRelief = -expansionPenalty * relief;
  const impracticalPenalty =
    input.geographicPracticality === "operationally_impractical" ? 200 : 0;
  return (
    input.balancedScore + distanceSortBonus + urgencyRelief + impracticalPenalty
  );
}

export function agentAcceptsProduct(
  scope: string,
  product: "airtel" | "safaricom",
): boolean {
  if (scope === "none") return false;
  if (scope === "both") return true;
  return scope === product;
}
