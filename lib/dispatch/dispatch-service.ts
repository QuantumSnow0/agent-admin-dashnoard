import type { SupabaseClient } from "@supabase/supabase-js";
import { DISPATCH_DEFAULTS, NOTIFICATION_TYPES } from "@/lib/dispatch/constants";
import { expireStaleOffers, runDispatchSweep } from "@/lib/dispatch/expire-offers";
import { deliverPushNotification } from "@/lib/dispatch/push-delivery";
import { formatLeadOfferNotificationCopy } from "@/lib/dispatch/lead-offer-notification-copy";
import {
  agentAcceptsProduct,
  buildOfferPreview,
  rankAgentsInCounty,
  rankFallbackAgents,
  resolveAgentPoint,
  resolveLeadPoint,
  type AgentCandidate,
  type LocationRef,
  type RankedAgent,
} from "@/lib/dispatch/matching";
import { distanceKm } from "@/lib/dispatch/geo";

type DispatchConfig = {
  dispatch_enabled: boolean;
  offer_timeout_minutes: number;
  max_open_leads_per_agent: number;
  max_open_leads_enabled: boolean;
  online_presence_minutes: number;
};

export async function loadDispatchConfig(
  service: SupabaseClient,
): Promise<DispatchConfig> {
  const { data } = await service
    .from("dispatch_config")
    .select(
      "dispatch_enabled, offer_timeout_minutes, max_open_leads_per_agent, max_open_leads_enabled, online_presence_minutes",
    )
    .limit(1)
    .maybeSingle();

  return {
    dispatch_enabled: data?.dispatch_enabled ?? true,
    offer_timeout_minutes:
      data?.offer_timeout_minutes ?? DISPATCH_DEFAULTS.offerTimeoutMinutes,
    max_open_leads_per_agent:
      data?.max_open_leads_per_agent ?? DISPATCH_DEFAULTS.maxOpenLeadsPerAgent,
    max_open_leads_enabled:
      data?.max_open_leads_enabled ?? DISPATCH_DEFAULTS.maxOpenLeadsEnabled,
    online_presence_minutes:
      data?.online_presence_minutes ?? DISPATCH_DEFAULTS.onlinePresenceMinutes,
  };
}

async function loadLocationRefs(service: SupabaseClient): Promise<LocationRef[]> {
  const { data, error } = await service.from("location_reference").select("*");
  if (error) throw error;
  return (data ?? []) as LocationRef[];
}

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

  const settingsMap = new Map((settings ?? []).map((s) => [s.agent_id, s]));

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
      type: NOTIFICATION_TYPES.LEAD_OFFER,
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
  const county = resolved?.county ?? lead.county ?? null;

  const agents = await loadEligibleAgents(service);
  const openCounts = await loadOpenLeadCounts(service);
  const excluded = await loadExcludedAgentIds(service, leadId);
  for (const id of options?.excludeAgentIds ?? []) {
    excluded.add(id);
  }

  let next: RankedAgent | null = null;
  let previewCounty = county;

  const maxOpenLeads = config.max_open_leads_enabled
    ? config.max_open_leads_per_agent
    : null;

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
      maxOpenLeads,
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
      maxOpenLeads,
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

  const packageLabel = lead.plan_label ?? lead.preferred_package ?? null;

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

  await service.from("inbound_leads").update({ status: "offered" }).eq("id", leadId);

  await notifyLeadOffer(service, next.agent_id, leadId, offer.id, preview);

  return { outcome: "offered", offerId: offer.id, agentId: next.agent_id };
}

const OFFERABLE_LEAD_STATUSES = [
  "admin_queue",
  "pending_dispatch",
  "offered",
  "needs_reassignment",
] as const;

/**
 * Admin picks the agent — still creates a blind offer so the agent accepts/declines.
 */
export async function offerLeadToAgent(
  service: SupabaseClient,
  leadId: string,
  agentId: string,
): Promise<
  | { outcome: "offered"; offerId: string; agentId: string }
  | { outcome: "error"; reason: string }
> {
  const config = await loadDispatchConfig(service);

  const { data: lead, error: leadError } = await service
    .from("inbound_leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (leadError || !lead) {
    return { outcome: "error", reason: "lead_not_found" };
  }

  if (
    !OFFERABLE_LEAD_STATUSES.includes(
      lead.status as (typeof OFFERABLE_LEAD_STATUSES)[number],
    )
  ) {
    return { outcome: "error", reason: `invalid_status_${lead.status}` };
  }

  const locationRefs = await loadLocationRefs(service);
  const resolved = resolveLeadPoint(lead.installation_town, locationRefs);
  const county = resolved?.county ?? lead.county ?? null;

  if (!county) {
    return { outcome: "error", reason: "unknown_county" };
  }

  const { data: agent, error: agentError } = await service
    .from("agents")
    .select("id, town, status, lead_dispatch_scope")
    .eq("id", agentId)
    .maybeSingle();

  if (agentError || !agent) {
    return { outcome: "error", reason: "agent_not_found" };
  }

  if (agent.status !== "approved") {
    return { outcome: "error", reason: "agent_not_approved" };
  }

  const product = lead.product as "airtel" | "safaricom";
  if (!agentAcceptsProduct(agent.lead_dispatch_scope ?? "both", product)) {
    return { outcome: "error", reason: "agent_scope_mismatch" };
  }

  let distance_km: number | null = null;
  if (resolved) {
    const agentPoint = resolveAgentPoint(agent.town, locationRefs);
    if (agentPoint) {
      distance_km = Math.round(distanceKm(resolved.point, agentPoint) * 10) / 10;
    }
  }

  const packageLabel = lead.plan_label ?? lead.preferred_package ?? null;
  const preview = buildOfferPreview(
    product,
    county,
    lead.installation_town,
    lead.installation_area,
    lead.delivery_landmark,
    packageLabel,
    lead.created_at,
    distance_km,
  );

  const expiresAt = new Date(
    Date.now() + config.offer_timeout_minutes * 60 * 1000,
  ).toISOString();

  const now = new Date().toISOString();

  await service
    .from("lead_offers")
    .update({ status: "superseded", responded_at: now })
    .eq("lead_id", leadId)
    .eq("status", "offered");

  const { data: priorOffers } = await service
    .from("lead_offers")
    .select("offer_sequence")
    .eq("lead_id", leadId)
    .order("offer_sequence", { ascending: false })
    .limit(1);

  const offerSequence = (priorOffers?.[0]?.offer_sequence ?? 0) + 1;

  const { data: offer, error: offerError } = await service
    .from("lead_offers")
    .insert({
      lead_id: leadId,
      agent_id: agentId,
      status: "offered",
      offer_sequence: offerSequence,
      distance_km,
      preview_payload: preview,
      expires_at: expiresAt,
      metadata: { offered_by: "admin" },
    })
    .select("id")
    .single();

  if (offerError || !offer) {
    return { outcome: "error", reason: offerError?.message ?? "offer_insert_failed" };
  }

  await service
    .from("inbound_leads")
    .update({
      status: "offered",
      county,
      assigned_agent_id: null,
      accepted_at: null,
    })
    .eq("id", leadId);

  await notifyLeadOffer(service, agentId, leadId, offer.id, preview);

  return { outcome: "offered", offerId: offer.id, agentId };
}

/** Sweep expired offers + optional admin-queue retry (no cron). */
export async function sweepDispatchQueue(
  service: SupabaseClient,
  options?: { county?: string | null },
) {
  return runDispatchSweep(service, dispatchLead, options);
}
