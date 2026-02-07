"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CheckCircle2, Clock, XCircle, Ban, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { AgentActions } from "@/components/agents/agent-actions";

const SEARCH_DEBOUNCE_MS = 300;

type AgentStatus = "all" | "approved" | "pending" | "rejected" | "banned";

type AgentRow = {
  id: string;
  name: string | null;
  email: string | null;
  airtel_phone: string | null;
  safaricom_phone: string | null;
  town: string | null;
  area: string | null;
  status: string;
  created_at: string | null;
};

const agentCards: { title: string; icon: typeof Users; cardBg: string; filter: AgentStatus }[] = [
  { title: "Registered", icon: Users, cardBg: "bg-indigo-600", filter: "all" },
  { title: "Approved", icon: CheckCircle2, cardBg: "bg-green-600", filter: "approved" },
  { title: "Pending", icon: Clock, cardBg: "bg-amber-600", filter: "pending" },
  { title: "Rejected", icon: XCircle, cardBg: "bg-orange-600", filter: "rejected" },
  { title: "Banned", icon: Ban, cardBg: "bg-red-600", filter: "banned" },
];

interface AgentsViewProps {
  agentsList: AgentRow[];
  counts: { registered: number; approved: number; pending: number; rejected: number; banned: number };
  currentFilter: AgentStatus;
  currentPage: number;
  totalPages: number;
  totalFiltered: number;
  pageSize: number;
  searchQuery: string;
  dateFrom: string;
  dateTo: string;
}

export function AgentsView({
  agentsList,
  counts,
  currentFilter,
  currentPage,
  totalPages,
  totalFiltered,
  pageSize,
  searchQuery,
  dateFrom,
  dateTo,
}: AgentsViewProps) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(searchQuery);
  const getValue = (f: AgentStatus) =>
    f === "all" ? counts.registered : counts[f];

  // Sync search input when URL/searchQuery changes (e.g. after navigation)
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  const applyFilters = useCallback(
    (q: string, from: string, to: string, page = 1) => {
      const params = new URLSearchParams();
      if (currentFilter !== "all") params.set("status", currentFilter);
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (page > 1) params.set("page", String(page));
      router.replace(`${baseHref}?${params.toString()}`, { scroll: false });
    },
    [currentFilter, router]
  );

  // Debounced search: update URL when user stops typing
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput.trim() !== searchQuery) {
        applyFilters(searchInput, dateFrom, dateTo, 1);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput, searchQuery, dateFrom, dateTo, applyFilters]);

  const handleDateFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    applyFilters(searchInput, e.target.value, dateTo, 1);
  };
  const handleDateToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    applyFilters(searchInput, dateFrom, e.target.value, 1);
  };

  const from = totalFiltered === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalFiltered);

  const baseHref = "/dashboard/agents";
  const params = new URLSearchParams();
  if (currentFilter !== "all") params.set("status", currentFilter);
  if (searchQuery) params.set("q", searchQuery);
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", dateTo);
  const queryString = params.toString();
  const pageQuery = (p: number) => (queryString ? `${queryString}&page=${p}` : `page=${p}`);
  const clearHref = currentFilter === "all" ? baseHref : `${baseHref}?status=${currentFilter}`;
  const hasFilters = !!searchQuery || !!dateFrom || !!dateTo;

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        {agentCards.map(({ title, icon: Icon, cardBg, filter: cardFilter }) => {
          const isActive = currentFilter === cardFilter;
          const cardParams = new URLSearchParams();
          if (cardFilter !== "all") cardParams.set("status", cardFilter);
          if (searchQuery) cardParams.set("q", searchQuery);
          if (dateFrom) cardParams.set("from", dateFrom);
          if (dateTo) cardParams.set("to", dateTo);
          cardParams.set("page", "1");
          const href = cardParams.toString() ? `${baseHref}?${cardParams.toString()}` : baseHref;
          return (
            <Link key={title} href={href}>
              <Card
                className={`relative gap-0 overflow-hidden rounded-none border-2 py-4 shadow-sm transition-all hover:shadow-md ${cardBg} ${isActive ? "border-white ring-2 ring-white/50" : "border-transparent"}`}
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 via-white/5 to-transparent" aria-hidden />
                <div className="relative z-10">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-2 pt-0">
                    <CardTitle className="text-xs font-medium uppercase tracking-wider text-white/90">{title}</CardTitle>
                    <div className="rounded-none bg-white/20 p-1.5">
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-0 pt-0">
                    <div className="text-xl font-bold text-white">{getValue(cardFilter)}</div>
                  </CardContent>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Search and date filter – instant (debounced search, immediate date) */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name, email, phone, town, area..."
          className="h-8 w-40 shrink-0 rounded border border-gray-200 bg-white px-2.5 text-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-52"
          aria-label="Search agents"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={handleDateFromChange}
          className="h-8 w-32 shrink-0 rounded border border-gray-200 bg-white px-2.5 text-sm text-gray-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label="From date"
        />
        <span className="text-xs text-gray-400">–</span>
        <input
          type="date"
          value={dateTo}
          onChange={handleDateToChange}
          className="h-8 w-32 shrink-0 rounded border border-gray-200 bg-white px-2.5 text-sm text-gray-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label="To date"
        />
        {hasFilters && (
          <Link
            href={clearHref}
            className="inline-flex h-8 items-center rounded border border-gray-200 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
          >
            Clear
          </Link>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            {currentFilter === "all" ? "All agents" : `${currentFilter} agents`}
          </h2>
          {totalFiltered > 0 && (
            <span className="text-xs text-gray-500">
              Showing {from}–{to} of {totalFiltered}
            </span>
          )}
        </div>
        {!agentsList.length ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 py-12 text-center text-gray-500">
            {hasFilters
              ? "No agents match your search or date filter."
              : currentFilter === "all"
                ? "No agents yet."
                : `No ${currentFilter} agents.`}
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="grid grid-cols-12 gap-4 border-b border-gray-200 bg-gray-50/80 px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              <div className="col-span-3">Name</div>
              <div className="col-span-3">Email</div>
              <div className="col-span-2">Phone</div>
              <div className="col-span-2">Location</div>
              <div className="col-span-1">Joined</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
              {agentsList.map((a) => {
                const rowBg =
                  a.status === "approved"
                    ? "bg-emerald-600"
                    : a.status === "pending"
                      ? "bg-amber-600"
                      : a.status === "rejected"
                        ? "bg-orange-600"
                        : a.status === "banned"
                          ? "bg-red-600"
                          : "bg-gray-600";
                return (
                  <div
                    key={a.id}
                    className={`grid grid-cols-12 gap-4 px-6 py-4 text-sm align-middle border-b border-white/10 last:border-b-0 text-white ${rowBg}`}
                  >
                    <div className="col-span-3 truncate font-medium">{a.name || "—"}</div>
                    <div className="col-span-3 truncate text-white/90">{a.email || "—"}</div>
                    <div className="col-span-2 truncate text-white/90">
                      {[a.airtel_phone, a.safaricom_phone].filter(Boolean).join(" · ") || "—"}
                    </div>
                    <div className="col-span-2 truncate text-white/90">
                      {[a.town, a.area].filter(Boolean).join(", ") || "—"}
                    </div>
                    <div className="col-span-1 text-white/90 text-xs">
                      {a.created_at
                        ? new Date(a.created_at).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </div>
                    <div className="col-span-1 flex items-center justify-end [&_button]:text-white [&_button:hover]:bg-white/20">
                      <AgentActions
                        agent={{
                          id: a.id,
                          name: a.name ?? undefined,
                          email: a.email ?? "",
                          status: a.status,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
                <span className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Link
                    href={currentPage <= 1 ? "#" : `${baseHref}?${pageQuery(currentPage - 1)}`}
                    className={`inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm font-medium transition-colors ${currentPage <= 1 ? "pointer-events-none border-gray-200 text-gray-400" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
                    aria-disabled={currentPage <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Link>
                  <Link
                    href={currentPage >= totalPages ? "#" : `${baseHref}?${pageQuery(currentPage + 1)}`}
                    className={`inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm font-medium transition-colors ${currentPage >= totalPages ? "pointer-events-none border-gray-200 text-gray-400" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
                    aria-disabled={currentPage >= totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
