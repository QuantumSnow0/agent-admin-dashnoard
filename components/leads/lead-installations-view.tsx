"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useDebouncedSearchParam } from "@/lib/hooks/use-debounced-search-param";
import {
  FileText,
  Clock,
  Package,
  Search,
  User,
  XCircle,
  Copy,
  Ban,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { AdminInboundLeadRow } from "@/lib/admin-leads";
import {
  LEAD_INSTALL_STATUS_STYLES,
  formatLeadInstallStatusLabel,
  leadInstallCommissionLabel,
} from "@/lib/lead-install-statuses";
import { getLeadInstallCommissionKes } from "@/lib/lead-install-commission";
import { LeadInstallStatusActions } from "@/components/leads/lead-install-status-actions";
import { LeadDetailPanel } from "@/components/leads/lead-detail-panel";

type AgentOption = { id: string; name: string | null };

type InstallCounts = {
  all: number;
  kyc: number;
  pending: number;
  installed: number;
  closed: number;
  rejected: number;
  duplicate: number;
  cancelled: number;
};

type LeadInstallationsViewProps = {
  leads: AdminInboundLeadRow[];
  error: string | null;
  statusFilter: string;
  searchQuery: string;
  agentIdFilter: string;
  agentsList: AgentOption[];
  counts: InstallCounts;
};

export function LeadInstallationsView({
  leads: initialLeads,
  error,
  statusFilter,
  searchQuery,
  agentIdFilter,
  agentsList,
  counts,
}: LeadInstallationsViewProps) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLead, setDetailLead] = useState<AdminInboundLeadRow | null>(null);

  useEffect(() => {
    setLeads(initialLeads);
  }, [initialLeads]);

  const openDetail = (lead: AdminInboundLeadRow) => {
    setDetailLead(lead);
    setDetailOpen(true);
  };

  const closeDetail = () => setDetailOpen(false);

  const detailId = detailLead?.id;
  useEffect(() => {
    if (!detailOpen || !detailId) return;
    const next = leads.find((l) => l.id === detailId);
    if (next) setDetailLead(next);
  }, [leads, detailOpen, detailId]);

  const applyParams = useCallback(
    (updates: { q?: string; agentId?: string; status?: string }) => {
      const params = new URLSearchParams();
      const nextStatus = updates.status ?? statusFilter;
      const nextAgentId =
        updates.agentId !== undefined ? updates.agentId : agentIdFilter;
      const nextQ = updates.q !== undefined ? updates.q : searchQuery;

      if (nextStatus !== "all") params.set("status", nextStatus);
      if (nextAgentId) params.set("agentId", nextAgentId);
      if (nextQ.trim()) params.set("q", nextQ.trim());

      const query = params.toString();
      router.replace(
        query
          ? `/dashboard/lead-installations?${query}`
          : "/dashboard/lead-installations",
        { scroll: false },
      );
    },
    [statusFilter, agentIdFilter, searchQuery, router],
  );

  const commitSearchQuery = useCallback(
    (q: string) => applyParams({ q }),
    [applyParams],
  );

  const { searchField, resetSearchInput } = useDebouncedSearchParam(
    searchQuery,
    commitSearchQuery,
  );

  const hasFilters = !!searchQuery || !!agentIdFilter;
  const clearFilters = () => {
    resetSearchInput("");
    applyParams({ agentId: "", q: "" });
  };

  const handleLeadUpdated = (updated: AdminInboundLeadRow) => {
    setDetailLead(updated);
    setLeads((prev) =>
      prev.map((row) => (row.id === updated.id ? updated : row)),
    );
    router.refresh();
  };

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-800">
        Error loading installations: {error}
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-3">
      <LeadDetailPanel
        lead={detailLead}
        open={detailOpen}
        onClose={closeDetail}
        statusFilter={statusFilter}
        feedback={null}
        actionLoading={null}
        onRetryDispatch={() => {}}
        onSendOffer={async () => {}}
        onLeadUpdated={handleLeadUpdated}
        installReviewMode
      />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input
          type="search"
          {...searchField}
          placeholder="Search customer, phone, SR, IMEI, town…"
          className="h-8 w-40 shrink-0 rounded border border-gray-200 bg-white px-2.5 text-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-52"
        />
        <span className="text-gray-300">|</span>
        <User className="h-4 w-4 shrink-0 text-gray-400" />
        <select
          value={agentIdFilter}
          onChange={(e) => applyParams({ agentId: e.target.value })}
          className="h-8 min-w-[140px] rounded border border-gray-200 bg-white px-2.5 text-sm text-gray-700"
        >
          <option value="">All agents</option>
          {agentsList.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || a.id.slice(0, 8)}
            </option>
          ))}
        </select>
        {hasFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-8 items-center rounded border border-gray-200 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
          >
            Clear filters
          </button>
        ) : null}
        <Link
          href="/dashboard/leads"
          className="ml-auto text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          ← Dispatch queue
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => applyParams({ status: v })}
          className="w-full"
        >
          <div className="border-b border-gray-100 px-4 pt-3 pb-0">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-0.5 rounded-lg bg-gray-50 p-0.5">
              <TabsTrigger value="all" className="rounded-md px-3 text-xs">
                All ({counts.all})
              </TabsTrigger>
              <TabsTrigger value="kyc" className="rounded-md px-3 text-xs">
                KYC done ({counts.kyc})
              </TabsTrigger>
              <TabsTrigger value="pending" className="rounded-md px-3 text-xs">
                <Clock className="mr-1.5 h-3.5 w-3.5" />
                Pending ({counts.pending})
              </TabsTrigger>
              <TabsTrigger value="installed" className="rounded-md px-3 text-xs">
                <Package className="mr-1.5 h-3.5 w-3.5" />
                Installed ({counts.installed})
              </TabsTrigger>
              <TabsTrigger value="closed" className="rounded-md px-3 text-xs">
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                Closed ({counts.closed})
              </TabsTrigger>
              <TabsTrigger value="rejected" className="rounded-md px-3 text-xs">
                Rejected ({counts.rejected})
              </TabsTrigger>
              <TabsTrigger value="duplicate" className="rounded-md px-3 text-xs">
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Duplicate ({counts.duplicate})
              </TabsTrigger>
              <TabsTrigger value="cancelled" className="rounded-md px-3 text-xs">
                <Ban className="mr-1.5 h-3.5 w-3.5" />
                Cancelled ({counts.cancelled})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={statusFilter} className="mt-0 outline-none">
            {!leads.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
                <FileText className="h-10 w-10 text-gray-300" />
                <p className="mt-2 text-sm">No installations in this view.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Proof</th>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Commission</th>
                      <th className="px-3 py-2">Agent</th>
                      <th className="px-3 py-2">Updated</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => {
                      const statusStyle =
                        LEAD_INSTALL_STATUS_STYLES[lead.status] ??
                        "bg-gray-100 text-gray-800 border-gray-200";
                      const proof =
                        lead.product === "airtel"
                          ? lead.airtel_sr_number
                          : lead.safaricom_imei;
                      return (
                        <tr
                          key={lead.id}
                          className="cursor-pointer border-b border-gray-100 hover:bg-gray-50/50"
                          onClick={() => openDetail(lead)}
                        >
                          <td className="px-3 py-2 capitalize">{lead.product}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">
                              {lead.customer_name}
                            </div>
                            <div className="text-gray-500">{lead.primary_phone}</div>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px]">
                            {proof ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {lead.installation_town ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyle}`}
                            >
                              {formatLeadInstallStatusLabel(lead.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {lead.status === "installed"
                              ? `KSh ${getLeadInstallCommissionKes(lead).toLocaleString()}`
                              : leadInstallCommissionLabel(lead.status)}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {lead.assigned_agent_name ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-500">
                            {lead.installed_at
                              ? new Date(lead.installed_at).toLocaleDateString()
                              : new Date(lead.created_at).toLocaleDateString()}
                          </td>
                          <td
                            className="px-3 py-2 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <LeadInstallStatusActions
                              lead={lead}
                              stopPropagation
                              onUpdated={(l) =>
                                handleLeadUpdated(l as AdminInboundLeadRow)
                              }
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
        </Tabs>
      </div>
    </div>
  );
}
