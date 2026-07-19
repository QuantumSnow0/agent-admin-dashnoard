/**
 * Core dispatch orchestration (v1).
 * Called by create-inbound-lead and lead-offer-action (decline / release).
 * v2: queue worker, pg_cron, county polygons, parallel offers.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { DISPATCH_DEFAULTS, NOTIFICATION_TYPE_LEAD_OFFER } from "./constants.ts";
import { formatLeadOfferNotificationCopy } from "./lead-offer-notification-copy.ts";
import { expireStaleOffers, runDispatchSweep } from "./expire-offers.ts";
import { deliverPushNotification } from "./push-delivery.ts";
import {
  buildOfferPreview,
  rankAgentsInCounty,
  rankFallbackAgents,
  resolveLeadPoint,
  type AgentCandidate,
  type LocationRef,
  type RankedAgent,
} from "./matching.ts";

type DispatchConfig = {
  dispatch_enabled: boolean;
  offer_timeout_minutes: number;
  max_open_leads_per_agent: number;
  online_presence_minutes: number;
};

export async function loadDispatchConfig(
  service: SupabaseClient,
): Promise<DispatchConfig> {
  const { data } = await service
    .from("dispatch_config")
    .select(
      "dispatch_enabled, offer_timeout_minutes, max_open_leads_per_agent, online_presence_minutes",
    )
    .limit(1)
    .maybeSingle();

  return {
    dispatch_enabled: data?.dispatch_enabled ?? true,
    offer_timeout_minutes:
      data?.offer_timeout_minutes ?? DISPATCH_DEFAULTS.offerTimeoutMinutes,
    max_open_leads_per_agent:
      data?.max_open_leads_per_agent ?? DISPATCH_DEFAULTS.maxOpenLeadsPerAgent,
    online_presence_minutes:
      data?.online_presence_minutes ?? DISPATCH_DEFAULTS.onlinePresenceMinutes,
  };
}

async function loadLocationRefs(service: SupabaseClient): Promise<LocationRef[]> {
  const { data, error } = await service.from("location_reference").select("*");
  if (error) throw error;
  return (data ?? []) as LocationRef[];
}

/** Count active assigned leads per agent for capacity checks. */
async function loadOpenLeadCounts(
  service: SupabaseClient,
): Promise<Map<string, number>> {
  const { data } = await service
    .from("inbound_leads")
    .select("assigned_agent_id")
    .in("status", ["assigned", "kyc_in_progress", "kyc_completed"])
    .not("assigned_agent_id", "is", null);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.assigned_agent_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function loadEligibleAgents(
  service: SupabaseClient,
): Promise<AgentCandidate[]> {
  const { data: agents, error } = await service
    .from("agents")
    .select("id, town, lead_dispatch_scope, status, is_fallback_agent, fallback_priority")
    .eq("status", "approved");

  if (error) throw error;

  const ids = (agents ?? []).map((a) => a.id);
  if (ids.length === 0) return [];

  const { data: settings } = await service
    .from("agent_dispatch_settings")
    .select("agent_id, is_available, county, last_seen_at")
    .in("agent_id", ids);

  const settingsMap = new Map(
    (settings ?? []).map((s) => [s.agent_id, s]),
  );

  return (agents ?? []).map((a) => {
    const s = settingsMap.get(a.id);
    return {
      agent_id: a.id,
      town: a.town,
      lead_dispatch_scope: a.lead_dispatch_scope ?? "both",
      is_available: s?.is_available ?? false,
      county: s?.county ?? null,
      last_seen_at: (s?.last_seen_at as string | null) ?? null,
      is_fallback_agent: Boolean(a.is_fallback_agent),
      fallback_priority: Number(a.fallback_priority ?? 100),
    };
  });
}

/** Agents already offered this lead (any terminal offer status) — skip on re-dispatch. */
async function loadExcludedAgentIds(
  service: SupabaseClient,
  leadId: string,
): Promise<Set<string>> {
  const { data } = await service
    .from("lead_offers")
    .select("agent_id")
    .eq("lead_id", leadId);

  return new Set((data ?? []).map((r) => r.agent_id as string));
}

async function notifyLeadOffer(
  service: SupabaseClient,
  agentId: string,
  leadId: string,
  offerId: string,
  preview: Record<string, unknown>,
): Promise<void> {
  const { title, message } = formatLeadOfferNotificationCopy(preview);

  const { data: notification, error: notifyError } = await service
    .from("notifications")
    .insert({
      agent_id: agentId,
      type: NOTIFICATION_TYPE_LEAD_OFFER,
      title,
      message,
      related_id: leadId,
      metadata: { offerId, preview },
    })
    .select("id, agent_id, type, title, message, related_id, metadata")
    .single();

  if (notifyError || !notification) {
    console.error("notifyLeadOffer insert failed:", notifyError);
    return;
  }

  await deliverPushNotification(notification);
}

export type DispatchLeadResult =
  | { outcome: "offered"; offerId: string; agentId: string }
  | { outcome: "admin_queue"; reason: string }
  | { outcome: "skipped"; reason: string };

/**
 * Offer lead to the nearest eligible agent in county not yet tried.
 * If none remain → admin_queue.
 */
export async function dispatchLead(
  service: SupabaseClient,
  leadId: string,
  options?: { skipSweep?: boolean; excludeAgentIds?: string[] },
): Promise<DispatchLeadResult> {
  if (!options?.skipSweep) {
    await expireStaleOffers(service, dispatchLead);
  }

  const config = await loadDispatchConfig(service);
  if (!config.dispatch_enabled) {
    return { outcome: "skipped", reason: "dispatch_disabled" };
  }

  const { data: lead, error: leadError } = await service
    .from("inbound_leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) {
    return { outcome: "skipped", reason: "lead_not_found" };
  }

  if (!["pending_dispatch", "needs_reassignment", "offered"].includes(lead.status)) {
    return { outcome: "skipped", reason: `status_${lead.status}` };
  }

  const locationRefs = await loadLocationRefs(service);
  const resolved = resolveLeadPoint(lead.installation_town, locationRefs);
  // Prefer canonical county from location_reference over client-supplied county
  // (Safaricom forms send town labels like "NAIROBI", not county names).
  const county = resolved?.county ?? lead.county ?? null;

  const agents = await loadEligibleAgents(service);
  const openCounts = await loadOpenLeadCounts(service);
  const excluded = await loadExcludedAgentIds(service, leadId);
  for (const id of options?.excludeAgentIds ?? []) {
    excluded.add(id);
  }

  let next: RankedAgent | null = null;
  const previewCounty = county;

  if (county && resolved) {
    if (lead.county !== county) {
      await service.from("inbound_leads").update({ county }).eq("id", leadId);
    }

    const ranked = rankAgentsInCounty(
      county,
      resolved.point,
      agents,
      locationRefs,
      lead.product,
      openCounts,
      config.max_open_leads_per_agent,
      config.online_presence_minutes,
    ).filter((a) => !excluded.has(a.agent_id));

    next = ranked[0] ?? null;
  }

  // No county match (or unknown town) → try designated fallback agents one-at-a-time.
  if (!next) {
    const fallbacks = rankFallbackAgents(
      resolved?.point ?? null,
      agents,
      locationRefs,
      lead.product,
      openCounts,
      config.max_open_leads_per_agent,
      config.online_presence_minutes,
    ).filter((a) => !excluded.has(a.agent_id));

    next = fallbacks[0] ?? null;
  }

  if (!next) {
    await service
      .from("inbound_leads")
      .update({ status: "admin_queue", county: previewCounty })
      .eq("id", leadId);

    await service
      .from("lead_offers")
      .update({ status: "expired", responded_at: new Date().toISOString() })
      .eq("lead_id", leadId)
      .eq("status", "offered");

    return {
      outcome: "admin_queue",
      reason:
        !county || !resolved
          ? "unknown_county_or_town"
          : "no_agents_or_fallback",
    };
  }

  const expiresAt = new Date(
    Date.now() + config.offer_timeout_minutes * 60 * 1000,
  ).toISOString();

  const packageLabel =
    lead.plan_label ?? lead.preferred_package ?? null;

  const preview = buildOfferPreview(
    lead.product,
    previewCounty,
    lead.installation_town,
    lead.installation_area,
    lead.delivery_landmark,
    packageLabel,
    lead.created_at,
    Number.isFinite(next.distance_km) && next.distance_km < 99999
      ? next.distance_km
      : null,
  );

  const { data: priorOffers } = await service
    .from("lead_offers")
    .select("offer_sequence")
    .eq("lead_id", leadId)
    .order("offer_sequence", { ascending: false })
    .limit(1);

  const offerSequence = (priorOffers?.[0]?.offer_sequence ?? 0) + 1;

  // Supersede any still-open offers before creating a new one
  await service
    .from("lead_offers")
    .update({ status: "superseded", responded_at: new Date().toISOString() })
    .eq("lead_id", leadId)
    .eq("status", "offered");

  const { data: offer, error: offerError } = await service
    .from("lead_offers")
    .insert({
      lead_id: leadId,
      agent_id: next.agent_id,
      status: "offered",
      offer_sequence: offerSequence,
      distance_km:
        Number.isFinite(next.distance_km) && next.distance_km < 99999
          ? next.distance_km
          : null,
      preview_payload: preview,
      expires_at: expiresAt,
      metadata: next.is_fallback_agent ? { offered_as: "fallback" } : {},
    })
    .select("id")
    .single();

  if (offerError || !offer) {
    throw offerError ?? new Error("Failed to create offer");
  }

  await service
    .from("inbound_leads")
    .update({ status: "offered" })
    .eq("id", leadId);

  await notifyLeadOffer(service, next.agent_id, leadId, offer.id, preview);

  return { outcome: "offered", offerId: offer.id, agentId: next.agent_id };
}

export async function sweepDispatchQueue(
  service: SupabaseClient,
  options?: { county?: string | null },
) {
  return runDispatchSweep(service, dispatchLead, options);
}
