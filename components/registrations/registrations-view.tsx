"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useDebouncedSearchParam } from "@/lib/hooks/use-debounced-search-param";
import { FileText, Clock, Package, Search, User, XCircle, Copy, Ban } from "lucide-react";
import {
  REGISTRATION_STATUS_STYLES,
  formatRegistrationStatusLabel,
} from "@/lib/registration-statuses";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RegistrationStatusActions } from "@/components/agents/registration-status-actions";
import type { AdminRegistrationRow } from "@/lib/admin-registrations";
import { RegistrationPackageBadge } from "@/components/registrations/registration-package-badge";
import { RegistrationDetailPanel } from "@/components/registrations/registration-detail-panel";

type AgentOption = { id: string; name: string | null };

type RegistrationCounts = {
  all: number;
  pending: number;
  installed: number;
  closed: number;
  rejected: number;
  duplicate: number;
  cancelled: number;
};

interface RegistrationsViewProps {
  registrations: AdminRegistrationRow[];
  error: Error | null;
  statusFilter: string;
  searchQuery: string;
  agentIdFilter: string;
  agentsList: AgentOption[];
  counts: RegistrationCounts;
}

export function RegistrationsView({
  registrations,
  error,
  statusFilter,
  searchQuery,
  agentIdFilter,
  agentsList,
  counts,
}: RegistrationsViewProps) {
  const router = useRouter();
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRegistration, setDetailRegistration] = useState<AdminRegistrationRow | null>(null);

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
        query ? `/dashboard/registrations?${query}` : "/dashboard/registrations",
        { scroll: false }
      );
    },
    [statusFilter, agentIdFilter, searchQuery, router]
  );

  const commitSearchQuery = useCallback(
    (q: string) => {
      applyParams({ q });
    },
    [applyParams]
  );

  const { searchField, resetSearchInput } = useDebouncedSearchParam(
    searchQuery,
    commitSearchQuery
  );

  const handleTabChange = (value: string) => {
    applyParams({ status: value });
  };

  const handleAgentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    applyParams({ agentId: e.target.value });
  };

  const hasFilters = !!searchQuery || !!agentIdFilter;
  const clearFilters = () => {
    resetSearchInput("");
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    const query = params.toString();
    router.replace(
      query ? `/dashboard/registrations?${query}` : "/dashboard/registrations",
      { scroll: false }
    );
  };

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-800">
        Error loading registrations: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0 max-w-full">
      {detailRegistration && (
        <RegistrationDetailPanel registration={detailRegistration} open={detailOpen} onClose={closeDetail} />
      )}
      {/* Search and agent filter */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input
          type="search"
          {...searchField}
          placeholder="Search name, email, phone, ID, package, location…"
          className="h-8 w-40 shrink-0 rounded border border-gray-200 bg-white px-2.5 text-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-52"
          aria-label="Search registrations"
        />
        <span className="text-gray-300">|</span>
        <User className="h-4 w-4 shrink-0 text-gray-400" />
        <select
          value={agentIdFilter}
          onChange={handleAgentChange}
          className="h-8 min-w-[140px] rounded border border-gray-200 bg-white px-2.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label="Filter by agent"
        >
          <option value="">All agents</option>
          {agentsList.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || a.id.slice(0, 8)}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-8 items-center rounded border border-gray-200 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden min-w-0 max-w-full">
      <Tabs value={statusFilter} onValueChange={handleTabChange} className="w-full">
        <div className="border-b border-gray-100 px-4 pt-3 pb-0">
          <TabsList className="h-8 w-full justify-start rounded-lg bg-gray-50 p-0.5 flex flex-wrap gap-0.5">
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

        <TabsContent value={statusFilter} className="mt-0 outline-none">
          {!registrations.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
              <FileText className="h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm">
                {hasFilters
                  ? "No registrations match your search or agent filter."
                  : statusFilter === "all"
                    ? "No customer registrations yet."
                    : `No ${statusFilter} registrations.`}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col className="w-[9%]" />
                  <col className="w-[11%]" />
                  <col className="w-[14%]" />
                  <col className="w-[5%]" />
                  <col className="w-[5%]" />
                  <col className="w-[11%]" />
                  <col className="w-[8%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                  <col className="w-[9%]" />
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
                    <th className="px-2 py-2">Agent</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((reg) => {
                    const statusStyle = REGISTRATION_STATUS_STYLES[reg.status] ?? "bg-gray-100 text-gray-800 border-gray-200";
                    const contact =
                      reg.source === "safaricom"
                        ? [reg.safaricom_number, reg.alternate_number, reg.email].filter(Boolean).join(" · ") || "—"
                        : [reg.airtel_number, reg.alternate_number, reg.email].filter(Boolean).join(" · ") || "—";
                    const agentName = (Array.isArray(reg.agents) ? reg.agents[0]?.name : reg.agents?.name) ?? "—";
                    const dateStr = reg.created_at
                      ? new Date(reg.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })
                      : "—";
                    const rowKey = `${reg.source}-${reg.id}`;
                    return (
                      <tr
                        key={rowKey}
                        role="button"
                        tabIndex={0}
                        title="View full details"
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
                            className="inline-flex rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700"
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
                        <td className="px-2 py-2 text-gray-600 truncate" title={reg.installation_town || reg.delivery_landmark || undefined}>
                          {reg.installation_town || reg.delivery_landmark || "—"}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${statusStyle}`}>
                            {formatRegistrationStatusLabel(reg.status)}
                          </span>
                        </td>
                        <td className="px-2 py-2 truncate" onClick={(e) => e.stopPropagation()}>
                          <Link
                            href={`/dashboard/agents/${reg.agent_id}`}
                            className="text-indigo-600 hover:text-indigo-800 font-medium truncate block"
                            title={agentName ?? undefined}
                          >
                            {agentName}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-gray-500 tabular-nums whitespace-nowrap" title={reg.created_at ? new Date(reg.created_at).toLocaleDateString() : undefined}>
                          {dateStr}
                        </td>
                        <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <RegistrationStatusActions registration={{ id: reg.id, status: reg.status, source: reg.source }} />
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
