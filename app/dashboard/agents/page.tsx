import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Image from "next/image";
import { AgentsView } from "@/components/agents/agents-view";

const PAGE_SIZE = 25;

type StatusFilter = "all" | "approved" | "pending" | "rejected" | "banned";

interface AgentsPageProps {
  searchParams: Promise<{ page?: string; status?: string; q?: string; from?: string; to?: string }>;
}

function escapeSearch(q: string): string {
  return q.trim().replace(/'/g, "''");
}

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const supabase = await createClient();
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const statusFilter = (params.status ?? "all") as StatusFilter;
  const searchQuery = (params.q ?? "").trim();
  const dateFrom = params.from ?? "";
  const dateTo = params.to ?? "";

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
  ] = await Promise.all([
    supabase.from("agents").select("*", { count: "exact", head: true }),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "approved"),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "rejected"),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "banned"),
  ]);

  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  let agentsQuery = supabase
    .from("agents")
    .select("id, name, email, airtel_phone, safaricom_phone, town, area, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  if (statusFilter !== "all") {
    agentsQuery = agentsQuery.eq("status", statusFilter);
  }
  if (searchQuery) {
    const escaped = escapeSearch(searchQuery);
    agentsQuery = agentsQuery.or(
      `name.ilike.%${escaped}%,email.ilike.%${escaped}%,town.ilike.%${escaped}%,area.ilike.%${escaped}%,airtel_phone.ilike.%${escaped}%,safaricom_phone.ilike.%${escaped}%`
    );
  }
  if (dateFrom) {
    agentsQuery = agentsQuery.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    agentsQuery = agentsQuery.lte("created_at", `${dateTo}T23:59:59.999Z`);
  }

  const [{ data: agentsList, count: filteredCount }, { data: appRatings }] =
    await Promise.all([
      agentsQuery.range(rangeFrom, rangeTo),
      supabase
        .from("app_ratings")
        .select("agent_id, score, created_at, opened_play_store"),
    ]);

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
        dateFrom={dateFrom}
        dateTo={dateTo}
      />
    </div>
  );
}
