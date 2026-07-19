import type { SupabaseClient } from "@supabase/supabase-js";
import { DISPATCH_DEFAULTS } from "@/lib/dispatch/constants";
import {
  LEAD_INSTALL_CLOSED_STATUSES,
  LEAD_INSTALL_REVIEW_STATUSES as INSTALL_PIPELINE_STATUSES,
} from "@/lib/lead-install-statuses";

export const LEAD_QUEUE_STATUSES = [
  "admin_queue",
  "pending_dispatch",
  "offered",
  "needs_reassignment",
] as const;

export const LEAD_ACTIVE_STATUSES = [
  "assigned",
  "kyc_in_progress",
  "kyc_completed",
] as const;

export const LEAD_CLOSED_STATUSES = ["lost", "expired"] as const;

/** Re-export for install review page (kyc_completed … cancelled). */
export const LEAD_INSTALL_PIPELINE_STATUSES = INSTALL_PIPELINE_STATUSES;

export type InboundLeadRecord = {
  id: string;
  source: string;
  product: string;
  status: string;
  county: string | null;
  installation_town: string | null;
  installation_area: string | null;
  delivery_landmark: string | null;
  customer_name: string;
  primary_phone: string;
  alternate_phone: string | null;
  email: string | null;
  plan_label: string | null;
  preferred_package: string | null;
  plan_group: string | null;
  visit_date: string | null;
  visit_time: string | null;
  assigned_agent_id: string | null;
  accepted_at: string | null;
  call_initiated_at: string | null;
  contact_verified_at: string | null;
  contact_verified_phone: string | null;
  contact_verification_method: string | null;
  kyc_started_at: string | null;
  kyc_completed_at: string | null;
  installed_at: string | null;
  kyc_outcome: string | null;
  airtel_sr_number: string | null;
  safaricom_imei: string | null;
  registration_id: string | null;
  commission_earned_ksh: number | null;
  created_at: string;
  source_external_id: string | null;
  metadata: Record<string, unknown>;
};

export type AdminInboundLeadRow = InboundLeadRecord & {
  assigned_agent_name: string | null;
  is_overdue: boolean;
  hours_since_accept: number | null;
  sla_hours: number;
};

export type AssignableAgentOption = {
  id: string;
  name: string | null;
  town: string | null;
  county: string | null;
  lead_dispatch_scope: string;
  is_available: boolean;
  scope_match: boolean;
  county_match: boolean;
};

const INBOUND_LEAD_SELECT = `
  id,
  source,
  product,
  status,
  county,
  installation_town,
  installation_area,
  delivery_landmark,
  customer_name,
  primary_phone,
  alternate_phone,
  email,
  plan_label,
  preferred_package,
  plan_group,
  visit_date,
  visit_time,
  assigned_agent_id,
  accepted_at,
  call_initiated_at,
  contact_verified_at,
  contact_verified_phone,
  contact_verification_method,
  kyc_started_at,
  kyc_completed_at,
  installed_at,
  kyc_outcome,
  airtel_sr_number,
  safaricom_imei,
  registration_id,
  commission_earned_ksh,
  created_at,
  source_external_id,
  metadata
`;

export function formatLeadStatusLabel(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function agentAcceptsProduct(
  scope: string,
  product: string,
): boolean {
  if (scope === "none") return false;
  if (scope === "both") return true;
  return scope === product;
}

export function isLeadOverdue(
  lead: Pick<InboundLeadRecord, "status" | "accepted_at">,
  slaHours: number,
): boolean {
  if (!lead.accepted_at) return false;
  if (!LEAD_ACTIVE_STATUSES.includes(lead.status as (typeof LEAD_ACTIVE_STATUSES)[number])) {
    return false;
  }
  const deadline =
    new Date(lead.accepted_at).getTime() + slaHours * 60 * 60 * 1000;
  return Date.now() > deadline;
}

export function hoursSinceAccept(acceptedAt: string | null): number | null {
  if (!acceptedAt) return null;
  const ms = Date.now() - new Date(acceptedAt).getTime();
  return Math.max(0, Math.floor(ms / (60 * 60 * 1000)));
}

export async function fetchDispatchSlaHours(
  service: SupabaseClient,
): Promise<number> {
  const { data } = await service
    .from("dispatch_config")
    .select("sla_hours")
    .limit(1)
    .maybeSingle();

  return data?.sla_hours ?? DISPATCH_DEFAULTS.slaHours;
}

export async function fetchAdminInboundLeads(
  service: SupabaseClient,
  options?: { statusFilter?: string; searchQuery?: string },
): Promise<{ leads: AdminInboundLeadRow[]; error: string | null }> {
  const slaHours = await fetchDispatchSlaHours(service);

  let query = service
    .from("inbound_leads")
    .select(INBOUND_LEAD_SELECT)
    .order("created_at", { ascending: false })
    .limit(500);

  const statusFilter = options?.statusFilter ?? "queue";

  if (statusFilter === "queue") {
    query = query.in("status", [...LEAD_QUEUE_STATUSES]);
  } else if (statusFilter === "active") {
    query = query.in("status", [...LEAD_ACTIVE_STATUSES]);
  } else if (statusFilter === "installations") {
    query = query.in("status", ["pending_install", "installed"]);
  } else if (statusFilter === "closed") {
    query = query.in("status", [...LEAD_CLOSED_STATUSES]);
  } else if (statusFilter === "overdue") {
    query = query.in("status", [...LEAD_ACTIVE_STATUSES]);
  } else if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const search = options?.searchQuery?.trim();
  if (search) {
    const escaped = search.replace(/'/g, "''");
    query = query.or(
      `customer_name.ilike.%${escaped}%,primary_phone.ilike.%${escaped}%,installation_town.ilike.%${escaped}%,county.ilike.%${escaped}%,email.ilike.%${escaped}%`,
    );
  }

  const { data: rows, error } = await query;

  if (error) {
    return { leads: [], error: error.message };
  }

  const rawLeads = (rows ?? []) as InboundLeadRecord[];
  const agentIds = [
    ...new Set(rawLeads.map((l) => l.assigned_agent_id).filter(Boolean)),
  ] as string[];

  const agentNameById = new Map<string, string | null>();
  if (agentIds.length > 0) {
    const { data: agents } = await service
      .from("agents")
      .select("id, name")
      .in("id", agentIds);
    for (const agent of agents ?? []) {
      agentNameById.set(agent.id, agent.name);
    }
  }

  let leads: AdminInboundLeadRow[] = rawLeads.map((lead) =>
    enrichLeadRow(lead, agentNameById, slaHours),
  );

  if (statusFilter === "overdue") {
    leads = leads.filter((lead) => lead.is_overdue);
  }

  return { leads, error: null };
}

function enrichLeadRow(
  lead: InboundLeadRecord,
  agentNameById: Map<string, string | null>,
  slaHours: number,
): AdminInboundLeadRow {
  return {
    ...lead,
    metadata: (lead.metadata ?? {}) as Record<string, unknown>,
    assigned_agent_name: lead.assigned_agent_id
      ? (agentNameById.get(lead.assigned_agent_id) ?? null)
      : null,
    is_overdue: isLeadOverdue(lead, slaHours),
    hours_since_accept: hoursSinceAccept(lead.accepted_at),
    sla_hours: slaHours,
  };
}

export async function fetchAdminInboundLeadById(
  service: SupabaseClient,
  leadId: string,
): Promise<{ lead: AdminInboundLeadRow | null; error: string | null }> {
  const slaHours = await fetchDispatchSlaHours(service);

  const { data: row, error } = await service
    .from("inbound_leads")
    .select(INBOUND_LEAD_SELECT)
    .eq("id", leadId)
    .maybeSingle();

  if (error) return { lead: null, error: error.message };
  if (!row) return { lead: null, error: null };

  const lead = row as InboundLeadRecord;
  const agentNameById = new Map<string, string | null>();

  if (lead.assigned_agent_id) {
    const { data: agent } = await service
      .from("agents")
      .select("id, name")
      .eq("id", lead.assigned_agent_id)
      .maybeSingle();
    if (agent) agentNameById.set(agent.id, agent.name);
  }

  return {
    lead: enrichLeadRow(lead, agentNameById, slaHours),
    error: null,
  };
}

export async function fetchAssignableAgents(
  service: SupabaseClient,
  lead: Pick<InboundLeadRecord, "product" | "county">,
): Promise<AssignableAgentOption[]> {
  const { data: agents, error } = await service
    .from("agents")
    .select("id, name, town, status, lead_dispatch_scope")
    .eq("status", "approved")
    .order("name", { ascending: true });

  if (error || !agents) return [];

  const agentIds = agents.map((a) => a.id);
  const { data: settings } = await service
    .from("agent_dispatch_settings")
    .select("agent_id, county, is_available")
    .in("agent_id", agentIds);

  const settingsByAgent = new Map(
    (settings ?? []).map((row) => [row.agent_id, row]),
  );

  return agents.map((agent) => {
    const dispatch = settingsByAgent.get(agent.id);
    const scopeMatch = agentAcceptsProduct(
      agent.lead_dispatch_scope,
      lead.product,
    );
    const countyMatch =
      !lead.county ||
      !dispatch?.county ||
      dispatch.county.toLowerCase() === lead.county.toLowerCase();

    return {
      id: agent.id,
      name: agent.name,
      town: agent.town,
      county: dispatch?.county ?? null,
      lead_dispatch_scope: agent.lead_dispatch_scope,
      is_available: dispatch?.is_available ?? false,
      scope_match: scopeMatch,
      county_match: countyMatch,
    };
  });
}

export function countLeadsByTab(leads: AdminInboundLeadRow[]) {
  return {
    queue: leads.filter((l) =>
      LEAD_QUEUE_STATUSES.includes(l.status as (typeof LEAD_QUEUE_STATUSES)[number]),
    ).length,
    active: leads.filter((l) =>
      LEAD_ACTIVE_STATUSES.includes(l.status as (typeof LEAD_ACTIVE_STATUSES)[number]),
    ).length,
    overdue: leads.filter((l) => l.is_overdue).length,
    installations: leads.filter(
      (l) => l.status === "pending_install" || l.status === "installed",
    ).length,
    closed: leads.filter((l) =>
      LEAD_CLOSED_STATUSES.includes(l.status as (typeof LEAD_CLOSED_STATUSES)[number]),
    ).length,
    all: leads.length,
  };
}

export async function fetchLeadTabCounts(service: SupabaseClient) {
  const slaHours = await fetchDispatchSlaHours(service);

  const [queueRes, activeRes, installedRes, closedRes, activeRowsRes] =
    await Promise.all([
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .in("status", [...LEAD_QUEUE_STATUSES]),
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .in("status", [...LEAD_ACTIVE_STATUSES]),
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending_install", "installed"]),
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .in("status", [...LEAD_CLOSED_STATUSES]),
      service
        .from("inbound_leads")
        .select("status, accepted_at")
        .in("status", [...LEAD_ACTIVE_STATUSES]),
    ]);

  const overdue =
    activeRowsRes.data?.filter((row) =>
      isLeadOverdue(
        { status: row.status, accepted_at: row.accepted_at },
        slaHours,
      ),
    ).length ?? 0;

  const queue = queueRes.count ?? 0;
  const active = activeRes.count ?? 0;
  const installations = installedRes.count ?? 0;
  const closed = closedRes.count ?? 0;
  const { count: allCount } = await service
    .from("inbound_leads")
    .select("id", { count: "exact", head: true });

  return {
    queue,
    active,
    overdue,
    installations,
    closed,
    all: allCount ?? 0,
  };
}

/** Install review queue — same scope as /dashboard/registrations for inbound leads. */
export async function fetchAdminLeadInstallations(
  service: SupabaseClient,
  options?: { statusFilter?: string; searchQuery?: string; agentId?: string },
): Promise<{ leads: AdminInboundLeadRow[]; error: string | null }> {
  const slaHours = await fetchDispatchSlaHours(service);

  let query = service
    .from("inbound_leads")
    .select(INBOUND_LEAD_SELECT)
    .in("status", [...LEAD_INSTALL_PIPELINE_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(500);

  const statusFilter = options?.statusFilter ?? "pending";

  if (statusFilter === "kyc") {
    query = query.eq("status", "kyc_completed");
  } else if (statusFilter === "pending") {
    query = query.eq("status", "pending_install");
  } else if (statusFilter === "installed") {
    query = query.eq("status", "installed");
  } else if (statusFilter === "closed") {
    query = query.in("status", [...LEAD_INSTALL_CLOSED_STATUSES]);
  } else if (statusFilter === "rejected") {
    query = query.eq("status", "rejected");
  } else if (statusFilter === "duplicate") {
    query = query.eq("status", "duplicate");
  } else if (statusFilter === "cancelled") {
    query = query.eq("status", "cancelled");
  }

  if (options?.agentId) {
    query = query.eq("assigned_agent_id", options.agentId);
  }

  const search = options?.searchQuery?.trim();
  if (search) {
    const escaped = search.replace(/'/g, "''");
    query = query.or(
      `customer_name.ilike.%${escaped}%,primary_phone.ilike.%${escaped}%,installation_town.ilike.%${escaped}%,county.ilike.%${escaped}%,airtel_sr_number.ilike.%${escaped}%,safaricom_imei.ilike.%${escaped}%`,
    );
  }

  const { data: rows, error } = await query;
  if (error) return { leads: [], error: error.message };

  const rawLeads = (rows ?? []) as InboundLeadRecord[];
  const agentIds = [
    ...new Set(rawLeads.map((l) => l.assigned_agent_id).filter(Boolean)),
  ] as string[];

  const agentNameById = new Map<string, string | null>();
  if (agentIds.length > 0) {
    const { data: agents } = await service
      .from("agents")
      .select("id, name")
      .in("id", agentIds);
    for (const agent of agents ?? []) {
      agentNameById.set(agent.id, agent.name);
    }
  }

  return {
    leads: rawLeads.map((lead) =>
      enrichLeadRow(lead, agentNameById, slaHours),
    ),
    error: null,
  };
}

export async function fetchLeadInstallationCounts(service: SupabaseClient) {
  const [allRes, kycRes, pendingRes, installedRes, rejectedRes, duplicateRes, cancelledRes] =
    await Promise.all([
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .in("status", [...LEAD_INSTALL_PIPELINE_STATUSES]),
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "kyc_completed"),
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_install"),
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "installed"),
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "rejected"),
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "duplicate"),
      service
        .from("inbound_leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "cancelled"),
    ]);

  const kyc = kycRes.count ?? 0;
  const pending = pendingRes.count ?? 0;
  const installed = installedRes.count ?? 0;
  const rejected = rejectedRes.count ?? 0;
  const duplicate = duplicateRes.count ?? 0;
  const cancelled = cancelledRes.count ?? 0;
  const closed = rejected + duplicate + cancelled;

  return {
    all: allRes.count ?? 0,
    kyc,
    pending,
    installed,
    closed,
    rejected,
    duplicate,
    cancelled,
  };
}
