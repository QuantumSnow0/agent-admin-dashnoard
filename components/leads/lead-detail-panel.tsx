"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Search,
  Send,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AdminInboundLeadRow, AssignableAgentOption } from "@/lib/admin-leads";
import {
  formatLeadStatusLabel,
  LEAD_ACTIVE_STATUSES,
  LEAD_QUEUE_STATUSES,
} from "@/lib/admin-leads";
import { getLeadReleaseInfo } from "@/lib/lead-release";
import { getLeadInstallCommissionKes } from "@/lib/lead-install-commission";
import { LeadInstallStatusActions } from "@/components/leads/lead-install-status-actions";
import { LEAD_INSTALL_COMMISSION_KES } from "@/lib/dispatch/constants";

const STATUS_STYLES: Record<string, string> = {
  admin_queue: "bg-amber-100 text-amber-800 border-amber-200",
  pending_dispatch: "bg-sky-100 text-sky-800 border-sky-200",
  offered: "bg-indigo-100 text-indigo-800 border-indigo-200",
  needs_reassignment: "bg-orange-100 text-orange-800 border-orange-200",
  assigned: "bg-blue-100 text-blue-800 border-blue-200",
  kyc_in_progress: "bg-violet-100 text-violet-800 border-violet-200",
  kyc_completed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  pending_install: "bg-amber-100 text-amber-900 border-amber-200",
  installed: "bg-green-100 text-green-800 border-green-200",
  lost: "bg-gray-100 text-gray-700 border-gray-200",
  expired: "bg-gray-100 text-gray-600 border-gray-200",
};

function productBadge(product: string) {
  return product === "airtel"
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-green-50 text-green-700 border-green-200";
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-gray-400 first:mt-0">
      {children}
    </h3>
  );
}

function matchesAgentSearch(agent: AssignableAgentOption, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [agent.name, agent.town, agent.county]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const display = value?.trim() ? value.trim() : "—";
  return (
    <div className="flex flex-col gap-0.5 border-b border-gray-100 py-2.5 sm:flex-row sm:gap-4">
      <dt className="w-full shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:w-36">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words text-sm text-gray-900">{display}</dd>
    </div>
  );
}

type LeadDetailPanelProps = {
  lead: AdminInboundLeadRow | null;
  open: boolean;
  onClose: () => void;
  statusFilter: string;
  feedback: string | null;
  actionLoading: string | null;
  onRetryDispatch: () => void;
  onSendOffer: (agentId: string) => Promise<void>;
  onLeadUpdated: (lead: AdminInboundLeadRow) => void;
  /** Hide dispatch controls — install review page only */
  installReviewMode?: boolean;
};

export function LeadDetailPanel({
  lead,
  open,
  onClose,
  statusFilter,
  feedback,
  actionLoading,
  onRetryDispatch,
  onSendOffer,
  onLeadUpdated,
  installReviewMode = false,
}: LeadDetailPanelProps) {
  const [agents, setAgents] = useState<AssignableAgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [sendingOffer, setSendingOffer] = useState(false);

  const canDispatch =
    lead && !installReviewMode
      ? LEAD_QUEUE_STATUSES.includes(lead.status as (typeof LEAD_QUEUE_STATUSES)[number])
      : false;

  const isActiveLead = lead
    ? LEAD_ACTIVE_STATUSES.includes(lead.status as (typeof LEAD_ACTIVE_STATUSES)[number])
    : false;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open || !lead?.id || !canDispatch) {
      setAgents([]);
      setAgentSearch("");
      setSelectedAgentId("");
      return;
    }

    let cancelled = false;
    setAgentsLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/leads/${lead.id}/assignable-agents`);
        const data = (await res.json()) as {
          agents?: AssignableAgentOption[];
          error?: string;
        };
        if (!cancelled && res.ok) {
          setAgents(data.agents ?? []);
        }
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, lead?.id, canDispatch]);

  const handleSendOffer = async () => {
    if (!selectedAgentId) return;
    setSendingOffer(true);
    try {
      await onSendOffer(selectedAgentId);
      setSelectedAgentId("");
    } finally {
      setSendingOffer(false);
    }
  };

  const filteredAgents = agents.filter((agent) => matchesAgentSearch(agent, agentSearch));
  const selectedAgentVisible = filteredAgents.some((agent) => agent.id === selectedAgentId);

  if (!lead) return null;

  const releaseInfo = getLeadReleaseInfo(lead);
  const showRelease =
    Boolean(releaseInfo.reason) &&
    releaseInfo.reason !== "completed" &&
    (lead.status === "needs_reassignment" ||
      lead.status === "admin_queue" ||
      lead.status === "offered" ||
      lead.status === "pending_dispatch" ||
      Boolean(lead.metadata?.lastRelease));

  return (
    <>
      <button
        type="button"
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        aria-label="Close lead details"
      />

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl transition-transform duration-200 ease-out sm:max-w-lg",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
        aria-hidden={!open}
      >
        <header className="shrink-0 border-b border-gray-100 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Inbound lead
              </p>
              <h2 className="mt-1 text-lg font-semibold leading-tight text-gray-900">
                {lead.customer_name}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                    productBadge(lead.product),
                  )}
                >
                  {lead.product}
                </span>
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                    STATUS_STYLES[lead.status] ?? "bg-gray-100 text-gray-700 border-gray-200",
                  )}
                >
                  {formatLeadStatusLabel(lead.status)}
                </span>
                {lead.is_overdue ? (
                  <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    Overdue
                  </span>
                ) : null}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {feedback ? (
            <p className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {feedback}
            </p>
          ) : null}

          {showRelease ? (
            <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
              <span className="font-semibold">Released: {releaseInfo.reasonLabel}</span>
              {releaseInfo.agentName ? ` by ${releaseInfo.agentName}` : ""}
              {releaseInfo.at ? ` · ${formatWhen(releaseInfo.at)}` : ""}
              {releaseInfo.notes ? (
                <>
                  <br />
                  <span className="text-orange-800">Note: {releaseInfo.notes}</span>
                </>
              ) : null}
            </p>
          ) : null}

          {isActiveLead ? (
            <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {lead.assigned_agent_name
                ? `${lead.assigned_agent_name} accepted this lead.`
                : "This lead is active with an assigned agent."}
              {statusFilter === "queue" ? " Check the Active tab for ongoing work." : ""}
            </p>
          ) : null}

          {lead.is_overdue ? (
            <p className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Past {lead.sla_hours}h SLA since accept ({lead.hours_since_accept ?? "?"}h ago).
            </p>
          ) : null}

          <dl>
            <SectionTitle>Contact</SectionTitle>
            <Field label="Primary phone" value={lead.primary_phone} />
            <Field label="Alternate phone" value={lead.alternate_phone} />
            <Field label="Email" value={lead.email} />
            {lead.call_initiated_at ? (
              <Field label="Call initiated" value={formatWhen(lead.call_initiated_at)} />
            ) : null}
            {lead.contact_verified_at ? (
              <Field
                label="Contact verified"
                value={`${formatWhen(lead.contact_verified_at)} via SMS OTP`}
              />
            ) : null}
            {lead.contact_verified_phone ? (
              <Field label="Verified phone" value={lead.contact_verified_phone} />
            ) : null}

            <SectionTitle>Installation</SectionTitle>
            <Field label="Town" value={lead.installation_town} />
            <Field label="County" value={lead.county} />
            <Field label="Area / landmark" value={lead.installation_area} />
            <Field label="Delivery landmark" value={lead.delivery_landmark} />
            <Field
              label="Plan"
              value={lead.plan_label ?? lead.preferred_package ?? undefined}
            />
            {lead.visit_date ? <Field label="Visit date" value={lead.visit_date} /> : null}
            {lead.visit_time ? <Field label="Visit time" value={lead.visit_time} /> : null}

            <SectionTitle>Dispatch</SectionTitle>
            <Field label="Assigned agent" value={lead.assigned_agent_name} />
            {lead.assigned_agent_id ? (
              <div className="flex flex-col gap-0.5 border-b border-gray-100 py-2.5 sm:flex-row sm:gap-4">
                <dt className="w-full shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:w-36">
                  Agent profile
                </dt>
                <dd className="min-w-0 flex-1">
                  <Link
                    href={`/dashboard/agents/${lead.assigned_agent_id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Open agent
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </dd>
              </div>
            ) : null}
            {lead.accepted_at ? (
              <Field label="Accepted at" value={formatWhen(lead.accepted_at)} />
            ) : null}

            <SectionTitle>Install proof</SectionTitle>
            {lead.product === "airtel" ? (
              <Field label="Airtel SR number" value={lead.airtel_sr_number} />
            ) : (
              <Field label="Device IMEI" value={lead.safaricom_imei} />
            )}
            {lead.installed_at ? (
              <Field label="Installed at" value={formatWhen(lead.installed_at)} />
            ) : null}
            {lead.status === "pending_install" ? (
              <Field
                label="Commission"
                value={`Awaiting admin confirm (KSh ${LEAD_INSTALL_COMMISSION_KES})`}
              />
            ) : null}
            {lead.status === "installed" ? (
              <Field
                label="Install commission"
                value={`KSh ${getLeadInstallCommissionKes(lead).toLocaleString()} — pay via agent payouts`}
              />
            ) : null}

            {(lead.status === "pending_install" ||
              lead.status === "installed" ||
              lead.status === "rejected" ||
              lead.status === "duplicate" ||
              lead.status === "cancelled" ||
              lead.status === "kyc_completed") && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Set status
                </span>
                <LeadInstallStatusActions lead={lead} onUpdated={onLeadUpdated} />
                {lead.assigned_agent_id ? (
                  <Link
                    href={`/dashboard/agents/${lead.assigned_agent_id}`}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Record payout on agent →
                  </Link>
                ) : null}
              </div>
            )}
            {lead.kyc_started_at ? (
              <Field label="KYC started" value={formatWhen(lead.kyc_started_at)} />
            ) : null}
            {lead.kyc_completed_at ? (
              <Field label="KYC completed" value={formatWhen(lead.kyc_completed_at)} />
            ) : null}
            {lead.kyc_outcome ? (
              <Field label="Outcome" value={releaseInfo.reasonLabel} />
            ) : null}
            {releaseInfo.notes ? (
              <Field label="Release notes" value={releaseInfo.notes} />
            ) : null}
            {releaseInfo.agentName ? (
              <Field label="Released by" value={releaseInfo.agentName} />
            ) : null}

            <SectionTitle>Record</SectionTitle>
            <Field label="Lead ID" value={lead.id} />
            {lead.registration_id ? (
              <Field label="Registration ID" value={lead.registration_id} />
            ) : null}
            <Field label="Source" value={lead.source} />
            <Field label="Submitted" value={formatWhen(lead.created_at)} />
          </dl>

          {canDispatch ? (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <SectionTitle>Dispatch actions</SectionTitle>
              <p className="mb-3 text-sm text-gray-600">
                Retry automatic matching or send a blind offer to a specific agent.
              </p>

              <Button
                type="button"
                variant="outline"
                className="mb-4 w-full justify-center"
                disabled={actionLoading !== null}
                onClick={onRetryDispatch}
              >
                <RefreshCw
                  className={cn(
                    "mr-2 h-4 w-4",
                    actionLoading === "retry" && "animate-spin",
                  )}
                />
                {actionLoading === "retry" ? "Retrying auto-dispatch…" : "Retry auto-dispatch"}
              </Button>

              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Send offer to agent
              </p>

              {agentsLoading ? (
                <p className="text-sm text-gray-500">Loading agents…</p>
              ) : agents.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                  No approved agents found for this product and area.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      value={agentSearch}
                      onChange={(e) => setAgentSearch(e.target.value)}
                      placeholder="Search agents by name, town, county…"
                      className="pl-9"
                    />
                  </div>

                  <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                    {filteredAgents.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                        No agents match &ldquo;{agentSearch.trim()}&rdquo;.
                      </p>
                    ) : null}
                    {filteredAgents.map((agent) => {
                      const selected = selectedAgentId === agent.id;
                      const warning =
                        !agent.scope_match
                          ? "Wrong product scope"
                          : !agent.county_match
                            ? "Different county"
                            : !agent.is_available
                              ? "Not available for leads"
                              : null;

                      return (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() => setSelectedAgentId(agent.id)}
                          className={cn(
                            "w-full rounded-lg border p-3 text-left transition-colors",
                            selected
                              ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                              : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900">
                                {agent.name ?? "Unnamed agent"}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-500">
                                {[agent.town, agent.county].filter(Boolean).join(" · ") ||
                                  "No location"}
                              </p>
                            </div>
                            {selected ? (
                              <User className="h-4 w-4 shrink-0 text-indigo-600" />
                            ) : null}
                          </div>
                          {warning ? (
                            <p className="mt-1.5 text-xs text-amber-700">{warning}</p>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  <Button
                    type="button"
                    className="w-full justify-center"
                    disabled={
                      !selectedAgentId ||
                      !selectedAgentVisible ||
                      sendingOffer ||
                      actionLoading !== null
                    }
                    onClick={() => void handleSendOffer()}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {sendingOffer ? "Sending offer…" : "Send offer to selected agent"}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
