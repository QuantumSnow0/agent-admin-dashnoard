import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, Clock, Package, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadInstallationsView } from "@/components/leads/lead-installations-view";
import {
  fetchAdminLeadInstallations,
  fetchLeadInstallationCounts,
} from "@/lib/admin-leads";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams: Promise<{ status?: string; q?: string; agentId?: string }>;
};

export default async function LeadInstallationsPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const params = await searchParams;
  const statusFilter = params.status || "all";
  const searchQuery = (params.q ?? "").trim();
  const agentIdFilter = (params.agentId ?? "").trim();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?error=not_authenticated");

  const { data: admin } = await supabase
    .from("agents")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!admin?.is_admin) redirect("/login?error=admin_access_required");

  let leads: Awaited<ReturnType<typeof fetchAdminLeadInstallations>>["leads"] =
    [];
  let error: string | null = null;
  let counts = {
    all: 0,
    kyc: 0,
    pending: 0,
    installed: 0,
    closed: 0,
    rejected: 0,
    duplicate: 0,
    cancelled: 0,
  };
  let agentsList: { id: string; name: string | null }[] = [];

  const serviceConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (serviceConfigured) {
    try {
      const service = createServiceClient();
      const [leadsResult, installCounts, agentsRes] = await Promise.all([
        fetchAdminLeadInstallations(service, {
          statusFilter,
          searchQuery,
          agentId: agentIdFilter || undefined,
        }),
        fetchLeadInstallationCounts(service),
        service
          .from("agents")
          .select("id, name")
          .eq("status", "approved")
          .order("name"),
      ]);
      leads = leadsResult.leads;
      error = leadsResult.error;
      counts = installCounts;
      agentsList = agentsRes.data ?? [];
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load";
    }
  }

  const countCards = [
    {
      title: "All",
      value: counts.all,
      href: "/dashboard/lead-installations",
      icon: FileText,
      cardBg: "bg-slate-600",
    },
    {
      title: "KYC done",
      value: counts.kyc,
      href: "/dashboard/lead-installations?status=kyc",
      icon: Clock,
      cardBg: "bg-sky-600",
    },
    {
      title: "Pending",
      value: counts.pending,
      href: "/dashboard/lead-installations?status=pending",
      icon: Clock,
      cardBg: "bg-amber-600",
    },
    {
      title: "Installed",
      value: counts.installed,
      href: "/dashboard/lead-installations?status=installed",
      icon: Package,
      cardBg: "bg-emerald-600",
    },
    {
      title: "Closed",
      value: counts.closed,
      href: "/dashboard/lead-installations?status=closed",
      icon: XCircle,
      cardBg: "bg-gray-600",
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Lead installations
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Same workflow as customer registrations:{" "}
          <strong>KYC done</strong> = registration submitted, ready to confirm
          install; <strong>Pending</strong> = agent submitted SR/IMEI proof;{" "}
          <strong>Installed</strong> = you confirmed → KSh 200 commission
          accrues. Record payouts on the agent profile (Payout Manager), not
          here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {countCards.map(({ title, value, href, icon: Icon, cardBg }) => (
          <Link key={title} href={href}>
            <Card
              className={`relative gap-0 overflow-hidden rounded-none border-2 py-4 shadow-sm transition-all hover:shadow-md ${cardBg} border-transparent hover:border-white/30`}
            >
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/30 via-white/5 to-transparent"
                aria-hidden
              />
              <div className="relative z-10">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-2 pt-0">
                  <CardTitle className="text-xs font-medium uppercase tracking-wider text-white/90">
                    {title}
                  </CardTitle>
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

      {!serviceConfigured ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Set SUPABASE_SERVICE_ROLE_KEY to manage lead installations.
        </div>
      ) : (
        <LeadInstallationsView
          leads={leads}
          error={error}
          statusFilter={statusFilter}
          searchQuery={searchQuery}
          agentIdFilter={agentIdFilter}
          agentsList={agentsList}
          counts={counts}
        />
      )}
    </div>
  );
}
