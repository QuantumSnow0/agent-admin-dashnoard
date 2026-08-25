"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { FileText, ExternalLink, Clock, Package, XCircle, Copy, Ban } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RegistrationStatusActions } from "@/components/agents/registration-status-actions";
import {
  formatAirtelAdminLocation,
  type AdminRegistrationRow,
} from "@/lib/admin-registrations";
import { RegistrationPackageBadge } from "@/components/registrations/registration-package-badge";
import { RegistrationDetailPanel } from "@/components/registrations/registration-detail-panel";
import {
  REGISTRATION_STATUS_STYLES,
  formatRegistrationStatusLabel,
  isClosedRegistrationStatus,
} from "@/lib/registration-statuses";
import type { AdminInboundLeadRow } from "@/lib/admin-leads";
import { formatLeadStatusLabel } from "@/lib/admin-leads";
import { LeadDetailPanel } from "@/components/leads/lead-detail-panel";
import { LeadInstallStatusActions } from "@/components/leads/lead-install-status-actions";
import {
  LEAD_INSTALL_STATUS_STYLES,
  formatLeadInstallStatusLabel,
} from "@/lib/lead-install-statuses";
import { getLeadInstallCommissionKes } from "@/lib/lead-install-commission";

type SourceView = "registered" | "inbound";

type StatusFilter =
  | "all"
  | "pending"
  | "installed"
  | "closed"
  | "rejected"
  | "duplicate"
  | "cancelled";

type InboundStatusFilter = "all" | "active" | "installed" | "closed";

const INBOUND_ACTIVE_STATUSES = [
  "assigned",
  "kyc_in_progress",
  "kyc_completed",
  "pending_install",
];

const INBOUND_CLOSED_STATUSES = [
  "lost",
  "expired",
  "rejected",
  "duplicate",
  "cancelled",
];

const INBOUND_STATUS_STYLES: Record<string, string> = {
  ...LEAD_INSTALL_STATUS_STYLES,
  assigned: "bg-blue-100 text-blue-800 border-blue-200",
  kyc_in_progress: "bg-violet-100 text-violet-800 border-violet-200",
  lost: "bg-gray-100 text-gray-700 border-gray-200",
  expired: "bg-gray-100 text-gray-600 border-gray-200",
};

interface AgentCustomersRegisteredProps {
  registrations: AdminRegistrationRow[];
  inboundLeads?: AdminInboundLeadRow[];
  inboundError?: string | null;
  agentId?: string;
}

export function AgentCustomersRegistered({
  registrations,
  inboundLeads = [],
  inboundError = null,
  agentId,
}: AgentCustomersRegisteredProps) {
  const [sourceView, setSourceView] = useState<SourceView>("registered");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [inboundStatusFilter, setInboundStatusFilter] =
    useState<InboundStatusFilter>("all");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRegistration, setDetailRegistration] = useState<AdminRegistrationRow | null>(null);
  const [leadDetailOpen, setLeadDetailOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<AdminInboundLeadRow | null>(null);
  const [leads, setLeads] = useState(inboundLeads);

  useEffect(() => {
    setLeads(inboundLeads);
  }, [inboundLeads]);

  const leadDetailId = detailLead?.id;
  useEffect(() => {
    if (!leadDetailOpen || !leadDetailId) return;
    const next = leads.find((l) => l.id === leadDetailId);
    if (next) setDetailLead(next);
  }, [leads, leadDetailOpen, leadDetailId]);

  const openDetail = (reg: AdminRegistrationRow) => {
    setDetailRegistration(reg);
    setDetailOpen(true);
  };

  const closeDetail = () => setDetailOpen(false);

  const detailId = detailRegistration?.id;
  const detailSource = detailRegistration?.source;
  useEffect(() => {
    if (!detailOpen || !detailId || !detailSource) return;
    const next = registrations.find((r) => r.id === detailId && r.source === detailSource);
    if (next) setDetailRegistration(next);
  }, [registrations, detailOpen, detailId, detailSource]);

  const counts = useMemo(() => {
    const all = registrations.length;
    const pending = registrations.filter((r) => r.status === "pending").length;
    const installed = registrations.filter((r) => r.status === "installed").length;
    const rejected = registrations.filter((r) => r.status === "rejected").length;
    const duplicate = registrations.filter((r) => r.status === "duplicate").length;
    const cancelled = registrations.filter((r) => r.status === "cancelled").length;
    const closed = rejected + duplicate + cancelled;
    return { all, pending, installed, closed, rejected, duplicate, cancelled };
  }, [registrations]);

  const getFiltered = (filter: StatusFilter) => {
    if (filter === "all") return registrations;
    if (filter === "closed") {
      return registrations.filter((r) => isClosedRegistrationStatus(r.status));
    }
    return registrations.filter((r) => r.status === filter);
  };

  const inboundCounts = useMemo(() => {
    const all = leads.length;
    const active = leads.filter((l) => INBOUND_ACTIVE_STATUSES.includes(l.status)).length;
    const installed = leads.filter((l) => l.status === "installed").length;
    const closed = leads.filter((l) => INBOUND_CLOSED_STATUSES.includes(l.status)).length;
    return { all, active, installed, closed };
  }, [leads]);

  const getFilteredInbound = (filter: InboundStatusFilter) => {
    if (filter === "all") return leads;
    if (filter === "active") {
      return leads.filter((l) => INBOUND_ACTIVE_STATUSES.includes(l.status));
    }
    if (filter === "installed") {
      return leads.filter((l) => l.status === "installed");
    }
    return leads.filter((l) => INBOUND_CLOSED_STATUSES.includes(l.status));
  };

  const inboundLink = agentId
    ? `/dashboard/lead-installations?agentId=${encodeURIComponent(agentId)}`
    : "/dashboard/leads";

  const sourceSwitch = (
    <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
      <button
        type="button"
        onClick={() => setSourceView("registered")}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          sourceView === "registered"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        Registered ({counts.all})
      </button>
      <button
        type="button"
        onClick={() => setSourceView("inbound")}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
          sourceView === "inbound"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        Inbound leads ({inboundCounts.all})
      </button>
    </div>
  );

  const tabFilters: StatusFilter[] = [
    "all",
    "pending",
    "installed",
    "closed",
    "rejected",
    "duplicate",
    "cancelled",
  ];

  const inboundTabFilters: InboundStatusFilter[] = [
    "all",
    "active",
    "installed",
    "closed",
  ];

  const openLeadDetail = (lead: AdminInboundLeadRow) => {
    setDetailLead(lead);
    setLeadDetailOpen(true);
  };

  const handleLeadUpdated = (updated: AdminInboundLeadRow) => {
    setDetailLead(updated);
    setLeads((prev) =>
      prev.map((row) => (row.id === updated.id ? updated : row)),
    );
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden min-w-0 max-w-full">
      <div className="border-b border-gray-100 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Customers registered
          </h2>
          {sourceSwitch}
        </div>
        <div className="flex items-center gap-3">
          {sourceView === "inbound" ? (
            <>
              <span className="text-xs text-gray-500">
                {inboundCounts.all} lead{inboundCounts.all === 1 ? "" : "s"}
              </span>
              <Link
                href={inboundLink}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                View all inbound leads
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </>
          ) : (
            <>
              <span className="text-xs text-gray-500">
                {counts.all} customer{counts.all === 1 ? "" : "s"}
              </span>
              <Link
                href="/dashboard/registrations"
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                View all registrations
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>

      {sourceView === "inbound" ? (
        inboundError ? (
          <div className="px-4 py-8 text-center text-sm text-red-800">
            Could not load inbound leads: {inboundError}
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
            <FileText className="h-10 w-10 text-gray-300" />
            <p className="mt-2 text-sm">No inbound leads assigned to this agent.</p>
            <Link
              href={inboundLink}
              className="mt-3 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              View all inbound leads →
            </Link>
          </div>
        ) : (
          <>
            <Tabs
              value={inboundStatusFilter}
              onValueChange={(v) =>
                setInboundStatusFilter(v as InboundStatusFilter)
              }
              className="w-full"
            >
              <div className="border-b border-gray-100 px-4 pt-2">
                <TabsList className="h-auto min-h-8 w-full justify-start rounded-lg bg-gray-50 p-0.5 flex flex-wrap gap-0.5">
                  <TabsTrigger
                    value="all"
                    className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm"
                  >
                    All ({inboundCounts.all})
                  </TabsTrigger>
                  <TabsTrigger
                    value="active"
                    className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm"
                  >
                    <Clock className="mr-1.5 h-3.5 w-3.5" />
                    Active ({inboundCounts.active})
                  </TabsTrigger>
                  <TabsTrigger
                    value="installed"
                    className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm"
                  >
                    <Package className="mr-1.5 h-3.5 w-3.5" />
                    Installed ({inboundCounts.installed})
                  </TabsTrigger>
                  <TabsTrigger
                    value="closed"
                    className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm"
                  >
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                    Closed ({inboundCounts.closed})
                  </TabsTrigger>
                </TabsList>
              </div>

              {inboundTabFilters.map((tabValue) => {
                const filtered = getFilteredInbound(tabValue);
                return (
                  <TabsContent
                    key={tabValue}
                    value={tabValue}
                    className="mt-0 outline-none"
                  >
                    {filtered.length === 0 ? (
                      <div className="py-12 text-center text-sm text-gray-500">
                        {tabValue === "all"
                          ? "No inbound leads."
                          : `No ${tabValue} inbound leads.`}
                      </div>
                    ) : (
                      <div className="min-w-0 overflow-x-auto">
                        <table className="w-full min-w-[720px] text-xs">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                              <th className="px-3 py-2">Product</th>
                              <th className="px-3 py-2">Customer</th>
                              <th className="px-3 py-2">Contact</th>
                              <th className="px-3 py-2">Plan</th>
                              <th className="px-3 py-2">Location</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">Date</th>
                              <th className="px-3 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((lead) => {
                              const statusStyle =
                                INBOUND_STATUS_STYLES[lead.status] ??
                                "bg-gray-100 text-gray-800 border-gray-200";
                              const location = [
                                lead.installation_town,
                                lead.county,
                              ]
                                .filter(Boolean)
                                .join(", ");
                              const contact = [
                                lead.primary_phone,
                                lead.alternate_phone,
                              ]
                                .filter(Boolean)
                                .join(" · ");
                              const dateStr = lead.created_at
                                ? new Date(lead.created_at).toLocaleDateString(
                                    "en-GB",
                                    {
                                      day: "numeric",
                                      month: "short",
                                      year: "2-digit",
                                    },
                                  )
                                : "—";
                              return (
                                <tr
                                  key={lead.id}
                                  role="button"
                                  tabIndex={0}
                                  className="cursor-pointer border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50"
                                  onClick={() => openLeadDetail(lead)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openLeadDetail(lead);
                                    }
                                  }}
                                >
                                  <td className="px-3 py-2">
                                    <span
                                      className={`inline-flex rounded border px-1 py-0.5 text-[10px] font-semibold uppercase ${
                                        lead.product === "safaricom"
                                          ? "border-green-200 bg-green-50 text-green-700"
                                          : "border-red-200 bg-red-50 text-red-700"
                                      }`}
                                    >
                                      {lead.product === "safaricom"
                                        ? "SF"
                                        : "AT"}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-medium text-gray-900">
                                    {lead.customer_name || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-gray-600">
                                    {contact || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-gray-600">
                                    {lead.plan_label ||
                                      lead.preferred_package ||
                                      "—"}
                                  </td>
                                  <td
                                    className="px-3 py-2 text-gray-600 truncate"
                                    title={location || undefined}
                                  >
                                    {location || "—"}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span
                                      className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${statusStyle}`}
                                    >
                                      {LEAD_INSTALL_STATUS_STYLES[lead.status]
                                        ? formatLeadInstallStatusLabel(
                                            lead.status,
                                          )
                                        : formatLeadStatusLabel(lead.status)}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">
                                    {dateStr}
                                    {lead.status === "installed" ? (
                                      <span className="ml-1 text-gray-400">
                                        · KSh{" "}
                                        {getLeadInstallCommissionKes(
                                          lead,
                                        ).toLocaleString()}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td
                                    className="px-3 py-2 text-right"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <LeadInstallStatusActions
                                      lead={lead}
                                      stopPropagation
                                      onUpdated={handleLeadUpdated}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
            <LeadDetailPanel
              lead={detailLead}
              open={leadDetailOpen}
              onClose={() => setLeadDetailOpen(false)}
              statusFilter="all"
              feedback={null}
              actionLoading={null}
              onRetryDispatch={() => {}}
              onSendOffer={async () => {}}
              onLeadUpdated={handleLeadUpdated}
              installReviewMode
            />
          </>
        )
      ) : registrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
          <FileText className="h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm">No customers registered yet.</p>
          <Link
            href="/dashboard/registrations"
            className="mt-3 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            View all registrations →
          </Link>
        </div>
      ) : (
        <>
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)} className="w-full">
            <div className="border-b border-gray-100 px-4 pt-2">
              <TabsList className="h-auto min-h-8 w-full justify-start rounded-lg bg-gray-50 p-0.5 flex flex-wrap gap-0.5">
                <TabsTrigger value="all" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  All ({counts.all})
                </TabsTrigger>
                <TabsTrigger value="pending" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Clock className="mr-1.5 h-3.5 w-3.5" />
                  Pending ({counts.pending})
                </TabsTrigger>
                <TabsTrigger value="installed" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Package className="mr-1.5 h-3.5 w-3.5" />
                  Installed ({counts.installed})
                </TabsTrigger>
                <TabsTrigger value="closed" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  Closed ({counts.closed})
                </TabsTrigger>
                <TabsTrigger value="rejected" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  Rejected ({counts.rejected})
                </TabsTrigger>
                <TabsTrigger value="duplicate" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Duplicate ({counts.duplicate})
                </TabsTrigger>
                <TabsTrigger value="cancelled" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Ban className="mr-1.5 h-3.5 w-3.5" />
                  Cancelled ({counts.cancelled})
                </TabsTrigger>
              </TabsList>
            </div>

            {tabFilters.map((tabValue) => {
              const filtered = getFiltered(tabValue);
              return (
                <TabsContent key={tabValue} value={tabValue} className="mt-0 outline-none">
                  {filtered.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-500">
                      {tabValue === "all" ? "No registrations." : `No ${tabValue} registrations.`}
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <table className="w-full table-fixed text-xs">
                        <colgroup>
                          <col className="w-[7%]" />
                          <col className="w-[13%]" />
                          <col className="w-[16%]" />
                          <col className="w-[6%]" />
                          <col className="w-[5%]" />
                          <col className="w-[12%]" />
                          <col className="w-[9%]" />
                          <col className="w-[8%]" />
                          <col className="w-[8%]" />
                          <col className="w-[16%]" />
                        </colgroup>
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                            <th className="px-2 py-2">Carrier</th>
                            <th className="px-2 py-2">Customer</th>
                            <th className="px-2 py-2">Contact</th>
                            <th className="px-2 py-2">Pkg</th>
                            <th className="px-2 py-2">Qty</th>
                            <th className="px-2 py-2">Location</th>
                            <th className="px-2 py-2">Status</th>
                            <th className="px-2 py-2">Date</th>
                            <th className="px-2 py-2">Visit</th>
                            <th className="px-2 py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((reg) => {
                            const regStatusStyle = REGISTRATION_STATUS_STYLES[reg.status] ?? "bg-gray-100 text-gray-800 border-gray-200";
                            const contact =
                              reg.source === "safaricom"
                                ? [reg.safaricom_number, reg.alternate_number, reg.email].filter(Boolean).join(" · ") || "—"
                                : [reg.airtel_number, reg.alternate_number, reg.email].filter(Boolean).join(" · ") || "—";
                            const location =
                              reg.source === "airtel"
                                ? formatAirtelAdminLocation(reg) ?? "—"
                                : reg.installation_town || reg.delivery_landmark || "—";
                            const visit =
                              reg.source === "airtel"
                                ? [reg.visit_date, reg.visit_time].filter(Boolean).join(" ") || "—"
                                : "—";
                            const dateStr = reg.created_at
                              ? new Date(reg.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })
                              : "—";
                            const rowKey = `${reg.source}-${reg.id}`;
                            return (
                              <tr
                                key={rowKey}
                                role="button"
                                tabIndex={0}
                                title="View details & commission"
                                className="cursor-pointer border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50"
                                onClick={() => openDetail(reg)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    openDetail(reg);
                                  }
                                }}
                              >
                                <td className="px-2 py-2 text-gray-600">
                                  <span
                                    className="inline-flex rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[10px] font-semibold uppercase text-gray-700"
                                    title={reg.source === "safaricom" ? "Safaricom" : "Airtel"}
                                  >
                                    {reg.source === "safaricom" ? "SF" : "AT"}
                                  </span>
                                </td>
                                <td className="px-2 py-2 font-medium text-gray-900 truncate" title={reg.customer_name || undefined}>
                                  {reg.customer_name || "—"}
                                </td>
                                <td className="px-2 py-2 text-gray-600 truncate" title={contact}>
                                  {contact}
                                </td>
                                <td className="px-2 py-2">
                                  <RegistrationPackageBadge reg={reg} />
                                </td>
                                <td className="px-2 py-2 text-gray-600 tabular-nums text-center">
                                  {reg.source === "airtel" ? reg.units_required ?? 1 : "—"}
                                </td>
                                <td className="px-2 py-2 text-gray-600 truncate" title={location !== "—" ? location : undefined}>
                                  {location}
                                </td>
                                <td className="px-2 py-2">
                                  <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${regStatusStyle}`}>
                                    {formatRegistrationStatusLabel(reg.status)}
                                  </span>
                                </td>
                                <td className="px-2 py-2 text-gray-500 tabular-nums whitespace-nowrap" title={reg.created_at ? new Date(reg.created_at).toLocaleDateString() : undefined}>
                                  {dateStr}
                                </td>
                                <td className="px-2 py-2 text-gray-500 truncate" title={visit || undefined}>
                                  {visit === "—" ? "—" : visit}
                                </td>
                                <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                  <RegistrationStatusActions
                                    registration={{ id: reg.id, status: reg.status, source: reg.source }}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>

          {detailRegistration ? (
            <RegistrationDetailPanel
              registration={detailRegistration}
              open={detailOpen}
              onClose={closeDetail}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
