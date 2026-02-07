import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Clock, CheckCircle2, Package } from "lucide-react";
import Link from "next/link";
import { RegistrationsView } from "@/components/registrations/registrations-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function escapeSearch(q: string): string {
  return q.trim().replace(/'/g, "''");
}

interface RegistrationsPageProps {
  searchParams: Promise<{ status?: string; q?: string; agentId?: string }>;
}

export default async function RegistrationsPage({ searchParams }: RegistrationsPageProps) {
  const supabase = await createClient();
  const params = await searchParams;
  const statusFilter = params.status || "all";
  const searchQuery = (params.q ?? "").trim();
  const agentIdFilter = (params.agentId ?? "").trim();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=not_authenticated");
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!agent?.is_admin) {
    redirect("/login?error=admin_access_required");
  }

  let registrationsQuery = supabase
    .from("customer_registrations")
    .select(
      `
      id,
      agent_id,
      customer_name,
      email,
      airtel_number,
      alternate_number,
      preferred_package,
      installation_town,
      delivery_landmark,
      visit_date,
      visit_time,
      status,
      created_at,
      agents(name)
    `
    )
    .order("created_at", { ascending: false });

  if (statusFilter !== "all") {
    registrationsQuery = registrationsQuery.eq("status", statusFilter);
  }
  if (agentIdFilter) {
    registrationsQuery = registrationsQuery.eq("agent_id", agentIdFilter);
  }
  if (searchQuery) {
    const escaped = escapeSearch(searchQuery);
    registrationsQuery = registrationsQuery.or(
      `customer_name.ilike.%${escaped}%,email.ilike.%${escaped}%,airtel_number.ilike.%${escaped}%,alternate_number.ilike.%${escaped}%,installation_town.ilike.%${escaped}%,delivery_landmark.ilike.%${escaped}%`
    );
  }

  const [
    { data: registrations, error },
    { data: agentsList },
    { count: totalCount },
    { count: pendingCount },
    { count: approvedCount },
    { count: installedCount },
  ] = await Promise.all([
    registrationsQuery,
    supabase.from("agents").select("id, name").order("name", { ascending: true, nullsFirst: false }),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("status", "approved"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("status", "installed"),
  ]);

  if (error) {
    console.error("Error fetching registrations:", error);
  }

  const countCards = [
    { title: "All", value: totalCount ?? 0, icon: FileText, cardBg: "bg-slate-600" },
    { title: "Pending", value: pendingCount ?? 0, icon: Clock, cardBg: "bg-amber-600" },
    { title: "Approved", value: approvedCount ?? 0, icon: CheckCircle2, cardBg: "bg-blue-600" },
    { title: "Installed", value: installedCount ?? 0, icon: Package, cardBg: "bg-emerald-600" },
  ];

  return (
    <div className="space-y-4 -ml-2 -mt-6">
      <div className="flex flex-row items-center gap-2">
        <FileText className="h-6 w-6 text-gray-700" />
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          Customer Registrations
        </h1>
      </div>
      <p className="text-sm text-gray-600">
        View and manage all customer registrations. Change status to move registrations through the pipeline.
      </p>

      {/* Count cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {countCards.map(({ title, value, icon: Icon, cardBg }) => (
          <Link
            key={title}
            href={title === "All" ? "/dashboard/registrations" : `/dashboard/registrations?status=${title.toLowerCase()}`}
          >
            <Card
              className={`relative gap-0 overflow-hidden rounded-none border-2 py-4 shadow-sm transition-all hover:shadow-md ${cardBg} border-transparent hover:border-white/30`}
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
                  <div className="text-xl font-bold text-white">{value}</div>
                </CardContent>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <RegistrationsView
        registrations={registrations ?? []}
        error={error}
        statusFilter={statusFilter}
        searchQuery={searchQuery}
        agentIdFilter={agentIdFilter}
        agentsList={agentsList ?? []}
        counts={{
          all: totalCount ?? 0,
          pending: pendingCount ?? 0,
          approved: approvedCount ?? 0,
          installed: installedCount ?? 0,
        }}
      />
    </div>
  );
}
