"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { FileText, Clock, CheckCircle2, Package, Search, User } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RegistrationStatusActions } from "@/components/agents/registration-status-actions";

const SEARCH_DEBOUNCE_MS = 300;

type RegistrationRow = {
  id: string;
  agent_id: string;
  customer_name: string | null;
  email: string | null;
  airtel_number: string | null;
  alternate_number: string | null;
  preferred_package: string;
  installation_town: string | null;
  delivery_landmark: string | null;
  visit_date: string | null;
  visit_time: string | null;
  status: string;
  created_at: string | null;
  agents: { name: string | null } | null;
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-blue-100 text-blue-800 border-blue-200",
  installed: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

type AgentOption = { id: string; name: string | null };

interface RegistrationsViewProps {
  registrations: RegistrationRow[];
  error: Error | null;
  statusFilter: string;
  searchQuery: string;
  agentIdFilter: string;
  agentsList: AgentOption[];
  counts: { all: number; pending: number; approved: number; installed: number };
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
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchQuery);

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  const applyParams = useCallback(
    (updates: { q?: string; agentId?: string; status?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (updates.q !== undefined) {
        if (updates.q.trim()) params.set("q", updates.q.trim());
        else params.delete("q");
      }
      if (updates.agentId !== undefined) {
        if (updates.agentId) params.set("agentId", updates.agentId);
        else params.delete("agentId");
      }
      if (updates.status !== undefined) {
        if (updates.status === "all") params.delete("status");
        else params.set("status", updates.status);
      }
      router.replace(`/dashboard/registrations${params.toString() ? `?${params.toString()}` : ""}`);
    },
    [searchParams, router]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput.trim() !== searchQuery) {
        applyParams({ q: searchInput });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput, searchQuery, applyParams]);

  const handleTabChange = (value: string) => {
    applyParams({ status: value });
  };

  const handleAgentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    applyParams({ agentId: e.target.value });
  };

  const hasFilters = !!searchQuery || !!agentIdFilter;
  const clearFilters = () => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    router.replace(`/dashboard/registrations${params.toString() ? `?${params.toString()}` : ""}`);
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
      {/* Search and agent filter */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search customer, email, phone, location…"
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
            <TabsTrigger value="approved" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Approved ({counts.approved})
            </TabsTrigger>
            <TabsTrigger value="installed" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Package className="mr-1.5 h-3.5 w-3.5" />
              Installed ({counts.installed})
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
                  <col className="w-[14%]" />
                  <col className="w-[18%]" />
                  <col className="w-[6%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[8%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    <th className="px-2 py-2">Customer</th>
                    <th className="px-2 py-2">Contact</th>
                    <th className="px-2 py-2">Pkg</th>
                    <th className="px-2 py-2">Location</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Agent</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((reg) => {
                    const statusStyle = STATUS_STYLES[reg.status] ?? "bg-gray-100 text-gray-800 border-gray-200";
                    const contact = [reg.airtel_number, reg.alternate_number, reg.email].filter(Boolean).join(" · ") || "—";
                    const agentName = reg.agents?.name ?? "—";
                    const dateStr = reg.created_at
                      ? new Date(reg.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })
                      : "—";
                    return (
                      <tr key={reg.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50">
                        <td className="px-2 py-2 font-medium text-gray-900 truncate" title={reg.customer_name || undefined}>
                          {reg.customer_name || "—"}
                        </td>
                        <td className="px-2 py-2 text-gray-600 truncate" title={contact}>
                          {contact}
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${
                              reg.preferred_package === "premium" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {reg.preferred_package === "premium" ? "P" : "S"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-gray-600 truncate" title={reg.installation_town || reg.delivery_landmark || undefined}>
                          {reg.installation_town || reg.delivery_landmark || "—"}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${statusStyle}`}>
                            {reg.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 truncate">
                          <Link
                            href={`/dashboard/agents/${reg.agent_id}`}
                            className="text-indigo-600 hover:text-indigo-800 font-medium truncate block"
                            title={agentName}
                          >
                            {agentName}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-gray-500 tabular-nums whitespace-nowrap" title={reg.created_at ? new Date(reg.created_at).toLocaleDateString() : undefined}>
                          {dateStr}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <RegistrationStatusActions registration={{ id: reg.id, status: reg.status }} />
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
