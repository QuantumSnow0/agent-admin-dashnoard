/**
 * Core dispatch orchestration (v1).
 * Called by create-inbound-lead and lead-offer-action (decline / release).
 * v2: queue worker, pg_cron, county polygons, parallel offers.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { DISPATCH_DEFAULTS, NOTIFICATION_TYPE_LEAD_OFFER } from "./constants.ts";
import {
  buildOfferPreview,
  rankAgentsInCounty,
  resolveLeadPoint,
  type AgentCandidate,
  type LocationRef,
} from "./matching.ts";

type DispatchConfig = {
  dispatch_enabled: boolean;
  offer_timeout_minutes: number;
  max_open_leads_per_agent: number;
};

export async function loadDispatchConfig(
  service: SupabaseClient,
): Promise<DispatchConfig> {
  const { data } = await service
    .from("dispatch_config")
    .select("dispatch_enabled, offer_timeout_minutes, max_open_leads_per_agent")
    .limit(1)
    .maybeSingle();

  return {
    dispatch_enabled: data?.dispatch_enabled ?? true,
    offer_timeout_minutes:
      data?.offer_timeout_minutes ?? DISPATCH_DEFAULTS.offerTimeoutMinutes,
    max_open_leads_per_agent:
      data?.max_open_leads_per_agent ?? DISPATCH_DEFAULTS.maxOpenLeadsPerAgent,
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
    .select("id, town, lead_dispatch_scope, status")
    .eq("status", "approved");

  if (error) throw error;

  const ids = (agents ?? []).map((a) => a.id);
  if (ids.length === 0) return [];

  const { data: settings } = await service
    .from("agent_dispatch_settings")
    .select("agent_id, is_available, county")
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
  const product = String(preview.product ?? "lead");
  const brand =
    product === "safaricom"
      ? "Safaricom"
      : product === "airtel"
        ? "Airtel"
        : product.charAt(0).toUpperCase() + product.slice(1);
  const town = String(preview.installationTown ?? "your area");
  const distance =
    preview.distanceKm != null ? `~${preview.distanceKm} km` : null;
  const pkg = preview.packageLabel ? String(preview.packageLabel) : null;
  const subtitle = [distance, pkg].filter(Boolean).join(" · ");
  const area = preview.roughArea ? String(preview.roughArea) : null;
  const location = [town, area].filter(Boolean).join(" · ");

  const title = `${brand} lead · ${town}`;
  const message =
    subtitle.length > 0
      ? `${location} — ${subtitle}. Accept or decline before the timer ends.`
      : `New ${brand} customer in ${location}. Tap to respond before the offer expires.`;

  await service.from("notifications").insert({
    agent_id: agentId,
    type: NOTIFICATION_TYPE_LEAD_OFFER,
    title,
    message,
    related_id: leadId,
    metadata: { offerId, preview },
  });
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
): Promise<DispatchLeadResult> {
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
  const county = lead.county ?? resolved?.county ?? null;

  if (!county || !resolved) {
    await service
      .from("inbound_leads")
      .update({ status: "admin_queue", county })
      .eq("id", leadId);
    return { outcome: "admin_queue", reason: "unknown_county_or_town" };
  }

  // Ensure county is stored on lead for admin filters
  if (!lead.county) {
    await service.from("inbound_leads").update({ county }).eq("id", leadId);
  }

  const agents = await loadEligibleAgents(service);
  const openCounts = await loadOpenLeadCounts(service);
  const excluded = await loadExcludedAgentIds(service, leadId);

  const ranked = rankAgentsInCounty(
    county,
    resolved.point,
    agents,
    locationRefs,
    lead.product,
    openCounts,
    config.max_open_leads_per_agent,
  ).filter((a) => !excluded.has(a.agent_id));

  if (ranked.length === 0) {
    await service
      .from("inbound_leads")
      .update({ status: "admin_queue" })
      .eq("id", leadId);

    // Expire any stale offered rows
    await service
      .from("lead_offers")
      .update({ status: "expired", responded_at: new Date().toISOString() })
      .eq("lead_id", leadId)
      .eq("status", "offered");

    return { outcome: "admin_queue", reason: "no_agents_in_county" };
  }

  const next = ranked[0];
  const expiresAt = new Date(
    Date.now() + config.offer_timeout_minutes * 60 * 1000,
  ).toISOString();

  const packageLabel =
    lead.plan_label ?? lead.preferred_package ?? null;

  const preview = buildOfferPreview(
    lead.product,
    county,
    lead.installation_town,
    lead.installation_area,
    lead.delivery_landmark,
    packageLabel,
    lead.created_at,
    next.distance_km,
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
      distance_km: next.distance_km,
      preview_payload: preview,
      expires_at: expiresAt,
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
