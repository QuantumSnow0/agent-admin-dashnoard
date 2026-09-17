import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import { AgentsView } from "@/components/agents/agents-view";

const PAGE_SIZE = 25;

type StatusFilter = "all" | "approved" | "pending" | "rejected" | "banned";

interface AgentsPageProps {
  searchParams: Promise<{
    [key: string]: string | string[] | undefined;
  }>;
}

function escapeSearch(q: string): string {
  return q.trim().replace(/'/g, "''");
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function allParams(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => item.trim())
    .filter(Boolean);
}

function applyMoneyRange<
  T extends {
    eq: (column: string, value: number) => T;
    gt: (column: string, value: number) => T;
    gte: (column: string, value: number) => T;
    lt: (column: string, value: number) => T;
  },
>(query: T, column: string, range: string): T {
  if (range === "zero") return query.eq(column, 0);
  if (range === "under_1k") return query.gt(column, 0).lt(column, 1000);
  if (range === "1k_5k") return query.gte(column, 1000).lt(column, 5000);
  if (range === "5k_plus") return query.gte(column, 5000);
  return query;
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const supabase = await createClient();
  const params = await searchParams;
  const page = Math.max(1, parseInt(firstParam(params.page) || "1", 10) || 1);
  const statuses = allParams(params.status).filter((value) =>
    ["approved", "pending", "rejected", "banned"].includes(value)
  );
  const statusFilter: StatusFilter =
    statuses.length === 1 ? (statuses[0] as StatusFilter) : "all";
  const searchQuery = firstParam(params.q).trim();
  const dateFrom = firstParam(params.from);
  const dateTo = firstParam(params.to);
  const towns = allParams(params.town);
  const areas = allParams(params.area);
  const connectFilter = firstParam(params.connect).toLowerCase();
  const joinedFilter = firstParam(params.joined);
  const ratingFilter = firstParam(params.rating);
  const locationFilter = firstParam(params.location);
  const dispatchScopes = allParams(params.scope).filter((value) =>
    ["both", "airtel", "safaricom", "none"].includes(value)
  );
  const fallbackFilter = firstParam(params.fallback);
  const earningsFilter = firstParam(params.earnings);
  const balanceFilter = firstParam(params.balance);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=not_authenticated");
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("is_admin, name, email")
    .eq("id", user.id)
    .single();

  if (!agent || !agent.is_admin) {
    redirect("/login?error=admin_access_required");
  }

  const [
    { count: registered },
    { count: approved },
    { count: pending },
    { count: rejected },
    { count: banned },
    { data: townRows },
    { data: areaRows },
    { data: appRatings },
  ] = await Promise.all([
    supabase.from("agents").select("*", { count: "exact", head: true }),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "approved"),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "rejected"),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "banned"),
    supabase.from("agents").select("town").not("town", "is", null),
    supabase.from("agents").select("area").not("area", "is", null),
    supabase
      .from("app_ratings")
      .select("agent_id, score, created_at, opened_play_store"),
  ]);

  const townOptions = Array.from(
    new Set(
      (townRows ?? [])
        .map((row) => (typeof row.town === "string" ? row.town.trim() : ""))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const areaOptions = Array.from(
    new Set(
      (areaRows ?? [])
        .map((row) => (typeof row.area === "string" ? row.area.trim() : ""))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  let agentsQuery = supabase
    .from("agents")
    .select(
      "id, name, email, airtel_phone, safaricom_phone, town, area, status, created_at, airtel_connect_opened, airtel_connect_opened_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (statuses.length > 0) {
    agentsQuery = agentsQuery.in("status", statuses);
  }
  if (searchQuery) {
    const escaped = escapeSearch(searchQuery);
    agentsQuery = agentsQuery.or(
      `name.ilike.%${escaped}%,email.ilike.%${escaped}%,town.ilike.%${escaped}%,area.ilike.%${escaped}%,airtel_phone.ilike.%${escaped}%,safaricom_phone.ilike.%${escaped}%`
    );
  }
  if (towns.length > 0) {
    agentsQuery = agentsQuery.in("town", towns);
  }
  if (areas.length > 0) {
    agentsQuery = agentsQuery.in("area", areas);
  }
  if (connectFilter === "opened") {
    agentsQuery = agentsQuery.eq("airtel_connect_opened", true);
  } else if (connectFilter === "not_opened") {
    agentsQuery = agentsQuery.eq("airtel_connect_opened", false);
  }
  if (dateFrom) {
    agentsQuery = agentsQuery.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    agentsQuery = agentsQuery.lte("created_at", `${dateTo}T23:59:59.999Z`);
  }

  const now = new Date();
  if (joinedFilter === "today") {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    agentsQuery = agentsQuery.gte("created_at", start.toISOString());
  } else if (["7d", "30d", "90d"].includes(joinedFilter)) {
    const days = Number.parseInt(joinedFilter, 10);
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    agentsQuery = agentsQuery.gte("created_at", start.toISOString());
  } else if (joinedFilter === "year") {
    agentsQuery = agentsQuery.gte(
      "created_at",
      new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
    );
  }

  if (ratingFilter) {
    const ratedIds = (appRatings ?? []).map((rating) => rating.agent_id);
    if (ratingFilter === "unrated") {
      if (ratedIds.length > 0) {
        agentsQuery = agentsQuery.not("id", "in", `(${ratedIds.join(",")})`);
      }
    } else {
      const score = Number.parseInt(ratingFilter, 10);
      const matchingIds = (appRatings ?? [])
        .filter((rating) => rating.score === score)
        .map((rating) => rating.agent_id);
      agentsQuery =
        matchingIds.length > 0
          ? agentsQuery.in("id", matchingIds)
          : agentsQuery.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  }

  if (locationFilter === "set") {
    agentsQuery = agentsQuery.not("working_place", "is", null);
  } else if (locationFilter === "missing") {
    agentsQuery = agentsQuery.is("working_place", null);
  }
  if (dispatchScopes.length > 0) {
    agentsQuery = agentsQuery.in("lead_dispatch_scope", dispatchScopes);
  }
  if (fallbackFilter === "yes") {
    agentsQuery = agentsQuery.eq("is_fallback_agent", true);
  } else if (fallbackFilter === "no") {
    agentsQuery = agentsQuery.eq("is_fallback_agent", false);
  }
  agentsQuery = applyMoneyRange(agentsQuery, "total_earnings", earningsFilter);
  agentsQuery = applyMoneyRange(agentsQuery, "available_balance", balanceFilter);

  const { data: agentsList, count: filteredCount } = await agentsQuery.range(
    rangeFrom,
    rangeTo
  );

  const ratingsByAgentId = new Map(
    (appRatings ?? []).map((rating) => [rating.agent_id, rating])
  );

  const agentsWithRatings = (agentsList ?? []).map((agentRow) => {
    const rating = ratingsByAgentId.get(agentRow.id);
    return {
      ...agentRow,
      app_rating: rating
        ? {
            score: rating.score,
            created_at: rating.created_at,
            opened_play_store: rating.opened_play_store,
          }
        : null,
    };
  });

  const totalFiltered = filteredCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

  return (
    <div className="space-y-6 -ml-2 -mt-6">
      <div className="flex flex-row items-center gap-2">
        <Image src={"/customer-service.png"} alt="agents icon" height={22} width={22}/>
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          Agents
        </h1>
      </div>

      <AgentsView
        agentsList={agentsWithRatings}
        counts={{
          registered: registered ?? 0,
          approved: approved ?? 0,
          pending: pending ?? 0,
          rejected: rejected ?? 0,
          banned: banned ?? 0,
        }}
        currentFilter={statusFilter}
        currentPage={page}
        totalPages={totalPages}
        totalFiltered={totalFiltered}
        pageSize={PAGE_SIZE}
        searchQuery={searchQuery}
        townOptions={townOptions}
        areaOptions={areaOptions}
      />
    </div>
  );
}
