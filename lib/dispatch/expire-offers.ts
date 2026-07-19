/**
 * Expire timed-out offers and re-dispatch without pg_cron.
 * Swept on: dispatchLead, agent heartbeat, admin dashboard poll.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type SweepResult = {
  expiredOffers: number;
  redispatchedLeadIds: string[];
  adminQueueRetried: number;
};

type DispatchLeadResult =
  | { outcome: "offered"; offerId: string; agentId: string }
  | { outcome: "admin_queue"; reason: string }
  | { outcome: "skipped"; reason: string };

type DispatchLeadFn = (
  service: SupabaseClient,
  leadId: string,
  options?: { skipSweep?: boolean },
) => Promise<DispatchLeadResult>;

let sweepInProgress = false;

/** Mark expired offers and offer the lead to the next eligible agent. */
export async function expireStaleOffers(
  service: SupabaseClient,
  dispatchLead: DispatchLeadFn,
): Promise<{ expiredOffers: number; redispatchedLeadIds: string[] }> {
  if (sweepInProgress) {
    return { expiredOffers: 0, redispatchedLeadIds: [] };
  }

  sweepInProgress = true;
  try {
    const now = new Date().toISOString();
    const { data: stale } = await service
      .from("lead_offers")
      .select("id, lead_id")
      .eq("status", "offered")
      .lt("expires_at", now)
      .order("expires_at", { ascending: true })
      .limit(50);

    if (!stale?.length) {
      return { expiredOffers: 0, redispatchedLeadIds: [] };
    }

    const redispatchedLeadIds: string[] = [];
    const seenLeadIds = new Set<string>();

    for (const offer of stale) {
      await service
        .from("lead_offers")
        .update({ status: "expired", responded_at: now })
        .eq("id", offer.id)
        .eq("status", "offered");

      if (seenLeadIds.has(offer.lead_id)) continue;
      seenLeadIds.add(offer.lead_id);

      const { data: lead } = await service
        .from("inbound_leads")
        .select("status")
        .eq("id", offer.lead_id)
        .maybeSingle();

      if (
        lead?.status === "offered" ||
        lead?.status === "pending_dispatch" ||
        lead?.status === "needs_reassignment"
      ) {
        await dispatchLead(service, offer.lead_id, { skipSweep: true });
        redispatchedLeadIds.push(offer.lead_id);
      }
    }

    return { expiredOffers: stale.length, redispatchedLeadIds };
  } finally {
    sweepInProgress = false;
  }
}

/** When an agent comes online, retry admin-queue leads in their county (no cron). */
export async function retryAdminQueueForCounty(
  service: SupabaseClient,
  county: string,
  dispatchLead: DispatchLeadFn,
  limit = 5,
): Promise<number> {
  const trimmed = county.trim();
  if (!trimmed) return 0;

  const { data: leads } = await service
    .from("inbound_leads")
    .select("id")
    .eq("status", "admin_queue")
    .ilike("county", trimmed)
    .order("created_at", { ascending: true })
    .limit(limit);

  let retried = 0;
  for (const lead of leads ?? []) {
    await service
      .from("inbound_leads")
      .update({ status: "pending_dispatch" })
      .eq("id", lead.id)
      .eq("status", "admin_queue");

    await dispatchLead(service, lead.id, { skipSweep: true });
    retried += 1;
  }

  return retried;
}

export async function runDispatchSweep(
  service: SupabaseClient,
  dispatchLead: DispatchLeadFn,
  options?: { county?: string | null },
): Promise<SweepResult> {
  const expired = await expireStaleOffers(service, dispatchLead);
  let adminQueueRetried = 0;
  if (options?.county?.trim()) {
    adminQueueRetried = await retryAdminQueueForCounty(
      service,
      options.county,
      dispatchLead,
    );
  }
  return {
    ...expired,
    adminQueueRetried,
  };
}
