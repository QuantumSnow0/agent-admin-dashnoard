import { createClient } from "@/lib/supabase/server";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, FileText, CheckCircle2, Users } from "lucide-react";
import { subDays } from "date-fns";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import { DashboardRealtime } from "@/components/dashboard/dashboard-realtime";
import { ConversionFunnelSection } from "@/components/dashboard/conversion-funnel";
import { CommissionLiabilityRow } from "@/components/dashboard/commission-liability-row";
import { GeographyBreakdownSection } from "@/components/dashboard/geography-breakdown";
import { AppRatingsChart } from "@/components/dashboard/app-ratings-chart";
import { buildAppRatingSummary } from "@/lib/app-rating-chart-data";
import {
  buildCarrierFunnel,
  buildChartRangeData,
  buildConversionFunnel,
  buildGeographyBreakdown,
  computeCommissionLiability,
} from "@/lib/dashboard-chart-data";
import { fetchCommissionRates } from "@/lib/agent-wallet";

export default async function DashboardPage() {
  const supabase = await createClient();

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

  const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

  const [
    { count: totalAgents },
    { count: custRegCount },
    { count: safRegCount },
    { count: pendingApprovals },
    { count: custPendingRegs },
    { count: safPendingRegs },
    { count: custInstalled },
    { count: safInstalled },
    { data: custRegsForCharts },
    { data: safRegsForCharts },
    { data: custRegsAll },
    { data: safRegsAll },
    { data: custGeoRows },
    { data: safGeoRows },
    { data: custInstalledAll },
    { data: safInstalledAll },
    { data: paymentRows },
    { data: allAgents },
    { data: appRatings },
    commissionRates,
  ] = await Promise.all([
    supabase.from("agents").select("*", { count: "exact", head: true }),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("commission_exempt", false),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("commission_exempt", false).eq("status", "pending"),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("commission_exempt", false).eq("status", "installed"),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("status", "installed"),
    supabase
      .from("customer_registrations")
      .select("agent_id, created_at, status, preferred_package, units_required, commission_package, commission_units")
      .eq("commission_exempt", false)
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("safaricom_registrations")
      .select(
        "agent_id, created_at, status, service_package, fiber_deal_id, portable_deal_id, dedicated_wifi_deal_id"
      )
      .gte("created_at", thirtyDaysAgo),
    supabase.from("customer_registrations").select("status").eq("commission_exempt", false),
    supabase.from("safaricom_registrations").select("status"),
    supabase
      .from("customer_registrations")
      .select("status, installation_town")
      .eq("commission_exempt", false),
    supabase
      .from("safaricom_registrations")
      .select(
        "status, service_package, fiber_region_name, fiber_cluster_name, install_town, install_county"
      ),
    supabase
      .from("customer_registrations")
      .select("preferred_package, units_required, commission_package, commission_units")
      .eq("status", "installed")
      .eq("commission_exempt", false),
    supabase
      .from("safaricom_registrations")
      .select(
        "service_package, fiber_deal_id, portable_deal_id, dedicated_wifi_deal_id"
      )
      .eq("status", "installed"),
    supabase.from("agent_payments").select("amount_ksh"),
    supabase.from("agents").select("id, name, email"),
    supabase.from("app_ratings").select("score, opened_play_store, created_at"),
    fetchCommissionRates(supabase),
  ]);

  const totalRegistrations = (custRegCount ?? 0) + (safRegCount ?? 0);
  const pendingRegistrations = (custPendingRegs ?? 0) + (safPendingRegs ?? 0);
  const installedCount = (custInstalled ?? 0) + (safInstalled ?? 0);

  const custChartRows = custRegsForCharts ?? [];
  const safChartRows = safRegsForCharts ?? [];
  const agentsList = allAgents ?? [];

  const chartDataByRange = {
    7: buildChartRangeData(custChartRows, safChartRows, agentsList, 7, commissionRates),
    30: buildChartRangeData(custChartRows, safChartRows, agentsList, 30, commissionRates),
  };

  const overallFunnel = buildConversionFunnel(custRegsAll ?? [], safRegsAll ?? []);
  const airtelFunnel = buildCarrierFunnel(custRegsAll ?? []);
  const safaricomFunnel = buildCarrierFunnel(safRegsAll ?? []);

  const commissionLiability = computeCommissionLiability(
    custInstalledAll ?? [],
    safInstalledAll ?? [],
    paymentRows ?? [],
    commissionRates
  );

  const geographyBreakdown = buildGeographyBreakdown(
    custGeoRows ?? [],
    safGeoRows ?? []
  );

  const appRatingSummary = buildAppRatingSummary(appRatings ?? []);

  const row1Cards = [
    { title: "Pending approvals", value: pendingApprovals ?? 0, icon: Clock, cardBg: "bg-amber-600" },
    { title: "Pending registrations", value: pendingRegistrations ?? 0, icon: FileText, cardBg: "bg-blue-600" },
    { title: "Installed", value: installedCount ?? 0, icon: CheckCircle2, cardBg: "bg-green-600" },
  ];
  const row2Cards = [
    { title: "Total agents", value: totalAgents ?? 0, icon: Users, cardBg: "bg-indigo-600" },
    { title: "Total registrations", value: totalRegistrations ?? 0, icon: FileText, cardBg: "bg-purple-600" },
    {
      title: "Install rate",
      value: `${overallFunnel.registeredToInstalledPct}%`,
      icon: CheckCircle2,
      cardBg: "bg-teal-600",
    },
  ];

  return (
    <div className="space-y-6 -mt-7 -ml-2">
      <DashboardRealtime />
      <div className="flex flex-row items-center gap-2">
        <Image src={"/dashboard.png"} alt="dashboard icon" height={22} width={22} />
        <h1 className="text-xl font-bold tracking-tight text-gray-900">Dashboard</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {row1Cards.map(({ title, value, icon: Icon, cardBg }) => (
          <Card
            key={title}
            className={`relative gap-0 overflow-hidden rounded-none border-0 ${cardBg} py-4 shadow-sm transition-all hover:shadow-md`}
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
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {row2Cards.map(({ title, value, icon: Icon, cardBg }) => (
          <Card
            key={title}
            className={`relative gap-0 overflow-hidden rounded-none border-0 ${cardBg} py-4 shadow-sm transition-all hover:shadow-md`}
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
        ))}
      </div>

      <CommissionLiabilityRow
        totalEarned={commissionLiability.totalEarned}
        totalPaid={commissionLiability.totalPaid}
        outstanding={commissionLiability.outstanding}
      />

      <ConversionFunnelSection
        overall={overallFunnel}
        airtel={airtelFunnel}
        safaricom={safaricomFunnel}
      />

      <GeographyBreakdownSection
        registrationsByLocation={geographyBreakdown.registrationsByLocation}
        installedByLocation={geographyBreakdown.installedByLocation}
      />

      <AppRatingsChart summary={appRatingSummary} />

      <DashboardCharts chartDataByRange={chartDataByRange} />
    </div>
  );
}
