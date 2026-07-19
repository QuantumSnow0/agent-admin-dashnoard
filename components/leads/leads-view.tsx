"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AdminInboundLeadRow } from "@/lib/admin-leads";
import {
  formatLeadStatusLabel,
  LEAD_ACTIVE_STATUSES,
} from "@/lib/admin-leads";
import { getLeadReleaseInfo } from "@/lib/lead-release";
import { getLeadInstallCommissionKes } from "@/lib/lead-install-commission";
import { LeadsRealtime } from "@/components/leads/leads-realtime";
import { LeadDetailPanel } from "@/components/leads/lead-detail-panel";
import { LeadInstallStatusActions } from "@/components/leads/lead-install-status-actions";
import { formatDispatchResultMessage } from "@/lib/dispatch/dispatch-messages";

type LeadTabCounts = {
  queue: number;
  active: number;
  overdue: number;
  installations: number;
  closed: number;
  all: number;
};

type LeadsViewProps = {
  leads: AdminInboundLeadRow[];
  error: string | null;
  statusFilter: string;
  searchQuery: string;
  counts: LeadTabCounts;
  serviceConfigured: boolean;
};

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

export function LeadsView({
  leads: initialLeads,
  error: initialError,
  statusFilter,
  searchQuery,
  counts: initialCounts,
  serviceConfigured,
}: LeadsViewProps) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [counts, setCounts] = useState(initialCounts);
  const [error, setError] = useState(initialError);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLead, setDetailLead] = useState<AdminInboundLeadRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const detailLeadIdRef = useRef<string | null>(null);

  useEffect(() => {
    detailLeadIdRef.current = detailLead?.id ?? null;
  }, [detailLead?.id]);

  const openLead = (lead: AdminInboundLeadRow) => {
    setDetailLead(lead);
    setDetailOpen(true);
    setFeedback(null);
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setFeedback(null);
  };

  const syncDetailLead = useCallback(async (leadId: string) => {
    const res = await fetch(`/api/admin/leads/${leadId}`, { cache: "no-store" });
    if (!res.ok) {
      setDetailOpen(false);
      setDetailLead(null);
      return;
    }
    const data = (await res.json()) as { lead?: AdminInboundLeadRow };
    if (data.lead) {
      setDetailLead(data.lead);
      setFeedback((prev) => {
        if (!prev?.includes("Offer sent")) return prev;
        if (
          LEAD_ACTIVE_STATUSES.includes(
            data.lead!.status as (typeof LEAD_ACTIVE_STATUSES)[number],
          )
        ) {
          return null;
        }
        return prev;
      });
    }
  }, []);

  useEffect(() => {
    setLeads(initialLeads);
    setCounts(initialCounts);
    setError(initialError);
  }, [initialLeads, initialCounts, initialError]);

  const refreshLeads = useCallback(async () => {
    if (!serviceConfigured) return;
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "queue") params.set("status", statusFilter);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const query = params.toString();
      const res = await fetch(`/api/admin/leads${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        leads?: AdminInboundLeadRow[];
        counts?: LeadTabCounts;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to refresh");
      if (data.leads) setLeads(data.leads);
      if (data.counts) setCounts(data.counts);
      setError(null);

      const openId = detailLeadIdRef.current;
      if (openId) await syncDetailLead(openId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh leads");
    } finally {
      setRefreshing(false);
    }
  }, [serviceConfigured, statusFilter, searchQuery, syncDetailLead]);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  const applyParams = useCallback(
    (updates: { status?: string; q?: string }) => {
      const params = new URLSearchParams();
      const nextStatus = updates.status ?? statusFilter;
      const nextQ = updates.q !== undefined ? updates.q : searchQuery;
      if (nextStatus !== "queue") params.set("status", nextStatus);
      if (nextQ.trim()) params.set("q", nextQ.trim());
      const query = params.toString();
      router.push(query ? `/dashboard/leads?${query}` : "/dashboard/leads");
    },
    [router, searchQuery, statusFilter],
  );

  const runRetryDispatch = () => {
    if (!detailLead) return;
    setActionLoading("retry");
    setFeedback(null);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/leads/${detailLead.id}/retry-dispatch`, {
          method: "POST",
        });
        const data = (await res.json()) as {
          error?: string;
          dispatch?: { outcome?: string; reason?: string; agentId?: string };
        };
        if (!res.ok) throw new Error(data.error ?? "Retry failed");
        setFeedback(formatDispatchResultMessage(data.dispatch));
        await refreshLeads();
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : "Retry failed");
      } finally {
        setActionLoading(null);
      }
    })();
  };

  const sendOfferToAgent = async (agentId: string) => {
    if (!detailLead) return;
    setFeedback(null);
    const res = await fetch(`/api/admin/leads/${detailLead.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    const data = (await res.json()) as { error?: string; agentName?: string };
    if (!res.ok) throw new Error(data.error ?? "Could not send offer");
    setFeedback(
      data.agentName
        ? `Offer sent to ${data.agentName}. Waiting for accept or decline in the app.`
        : "Offer sent. Waiting for accept or decline in the app.",
    );
    await refreshLeads();
  };

  return (
    <div className="space-y-4">
      <LeadsRealtime onRefresh={refreshLeads} onStatus={setLiveConnected} />

      <LeadDetailPanel
        lead={detailLead}
        open={detailOpen}
        onClose={closeDetail}
        statusFilter={statusFilter}
        feedback={feedback}
        actionLoading={actionLoading}
        onRetryDispatch={runRetryDispatch}
        onSendOffer={sendOfferToAgent}
        onLeadUpdated={(lead) => {
          setDetailLead(lead);
          setLeads((prev) =>
            prev.map((row) => (row.id === lead.id ? lead : row)),
          );
          void refreshLeads();
        }}
      />

      {!serviceConfigured ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Set <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> in the admin
          dashboard environment to load and manage inbound leads.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyParams({ q: localSearch });
            }}
            placeholder="Search name, phone, town, county…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => applyParams({ q: localSearch })}>
            Search
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing || !serviceConfigured}
            onClick={() => void refreshLeads()}
          >
            <RefreshCw
              className={cn("mr-2 h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            Refresh
          </Button>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              liveConnected
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-gray-200 bg-gray-50 text-gray-500",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                liveConnected ? "bg-emerald-500 animate-pulse" : "bg-gray-400",
              )}
              aria-hidden
            />
            {liveConnected ? "Live" : "Connecting…"}
          </span>
        </div>
      </div>

      <Tabs value={statusFilter} onValueChange={(value) => applyParams({ status: value })}>
        <TabsList className="flex h-auto w-full flex-wrap gap-1 bg-gray-100 p-1">
          <TabsTrigger value="queue">Queue ({counts.queue})</TabsTrigger>
          <TabsTrigger value="active">Active ({counts.active})</TabsTrigger>
          <TabsTrigger value="overdue">Overdue ({counts.overdue})</TabsTrigger>
          <TabsTrigger value="installations">
            Installations ({counts.installations})
          </TabsTrigger>
          <TabsTrigger value="closed">Closed ({counts.closed})</TabsTrigger>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
        </TabsList>

        <TabsContent value={statusFilter} className="mt-4">
          {leads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-500">
              No leads in this view.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Agent</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">
                        Commission
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Submitted</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {leads.map((lead) => {
                      const selected = detailOpen && detailLead?.id === lead.id;
                      const statusStyle =
                        STATUS_STYLES[lead.status] ??
                        "bg-gray-100 text-gray-700 border-gray-200";
                      const releaseInfo = getLeadReleaseInfo(lead);
                      const showReleaseChip =
                        Boolean(releaseInfo.reason) &&
                        releaseInfo.reason !== "completed" &&
                        (lead.status === "needs_reassignment" ||
                          lead.status === "admin_queue" ||
                          Boolean(lead.metadata?.lastRelease));
                      return (
                        <tr
                          key={lead.id}
                          className={cn(
                            "cursor-pointer transition-colors",
                            selected
                              ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                              : "hover:bg-gray-50",
                          )}
                          onClick={() => openLead(lead)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{lead.customer_name}</div>
                            <div className="text-xs text-gray-500">{lead.primary_phone}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                                productBadge(lead.product),
                              )}
                            >
                              {lead.product}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            <div>{lead.installation_town ?? "—"}</div>
                            <div className="text-xs text-gray-500">
                              {lead.county ?? "Unknown county"}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                                  statusStyle,
                                )}
                              >
                                {formatLeadStatusLabel(lead.status)}
                              </span>
                              {showReleaseChip ? (
                                <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-800">
                                  {releaseInfo.reasonLabel}
                                </span>
                              ) : null}
                              {lead.is_overdue ? (
                                <Badge variant="destructive" className="text-[10px]">
                                  Overdue
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {lead.assigned_agent_name ??
                              (releaseInfo.agentName
                                ? `Was: ${releaseInfo.agentName}`
                                : "—")}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-gray-700">
                            {lead.status === "installed"
                              ? `KSh ${getLeadInstallCommissionKes(lead).toLocaleString()}`
                              : lead.status === "pending_install"
                                ? "Pending review"
                                : "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {formatWhen(lead.created_at)}
                          </td>
                          <td
                            className="px-4 py-3 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <LeadInstallStatusActions
                              lead={lead}
                              stopPropagation
                              onUpdated={(updated) => {
                                setLeads((prev) =>
                                  prev.map((row) =>
                                    row.id === updated.id ? updated : row,
                                  ),
                                );
                                if (detailLead?.id === updated.id) {
                                  setDetailLead(updated);
                                }
                                void refreshLeads();
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
