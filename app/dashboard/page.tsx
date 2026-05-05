import { createClient } from "@/lib/supabase/server";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, FileText, CheckCircle2, Users, DollarSign } from "lucide-react";
import { subDays, eachDayOfInterval, format, startOfDay } from "date-fns";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import { DashboardRealtime } from "@/components/dashboard/dashboard-realtime";

// Revenue per installed registration (KSh) – change these to update earnings everywhere
const REVENUE_STANDARD = 300;
const REVENUE_PREMIUM = 500;

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

  // Fetch counts in parallel
  const [
    { count: totalAgents },
    { count: custRegCount },
    { count: safRegCount },
    { count: pendingApprovals },
    { count: custPendingRegs },
    { count: safPendingRegs },
    { count: custInstalled },
    { count: safInstalled },
  ] = await Promise.all([
    supabase.from("agents").select("*", { count: "exact", head: true }),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }),
    supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("status", "installed"),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("status", "installed"),
  ]);

  const totalRegistrations = (custRegCount ?? 0) + (safRegCount ?? 0);
  const pendingRegistrations = (custPendingRegs ?? 0) + (safPendingRegs ?? 0);
  const installedCount = (custInstalled ?? 0) + (safInstalled ?? 0);

  const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

  const [
    { data: custRegsLast30 },
    { data: safRegsLast30 },
    { data: installedRegsAll },
  ] = await Promise.all([
    supabase.from("customer_registrations").select("created_at").gte("created_at", thirtyDaysAgo),
    supabase.from("safaricom_registrations").select("created_at").gte("created_at", thirtyDaysAgo),
    supabase.from("customer_registrations").select("created_at, preferred_package").eq("status", "installed"),
  ]);

  const allRegsLast30 = [...(custRegsLast30 ?? []), ...(safRegsLast30 ?? [])];

  const premiumCount = installedRegsAll?.filter((r) => r.preferred_package === "premium").length ?? 0;
  const standardCount = installedRegsAll?.filter((r) => r.preferred_package === "standard").length ?? 0;
  const totalEarnings = premiumCount * REVENUE_PREMIUM + standardCount * REVENUE_STANDARD;

  const dayRange = eachDayOfInterval({
    start: subDays(new Date(), 30),
    end: new Date(),
  });

  const registrationsByDay = dayRange.map((day) => {
    const dayStart = startOfDay(day).getTime();
    const count =
      allRegsLast30?.filter((r) => r.created_at && startOfDay(new Date(r.created_at)).getTime() === dayStart).length ?? 0;
    return { date: format(day, "MMM d"), count };
  });

  const revenueByDay = dayRange.map((day) => {
    const dayStart = startOfDay(day).getTime();
    const dayInstalled =
      installedRegsAll?.filter((r) => r.created_at && startOfDay(new Date(r.created_at)).getTime() === dayStart) ?? [];
    const revenue =
      dayInstalled.reduce((sum, r) => sum + (r.preferred_package === "premium" ? REVENUE_PREMIUM : REVENUE_STANDARD), 0);
    return { date: format(day, "MMM d"), revenue };
  });

  const packageMix = [
    { name: "Standard", value: standardCount },
    { name: "Premium", value: premiumCount },
    { name: "Safaricom", value: safInstalled ?? 0 },
  ];

  const row1Cards = [
    { title: "Pending approvals", value: pendingApprovals ?? 0, icon: Clock, cardBg: "bg-amber-600" },
    { title: "Pending registrations", value: pendingRegistrations ?? 0, icon: FileText, cardBg: "bg-blue-600" },
    { title: "Installed", value: installedCount ?? 0, icon: CheckCircle2, cardBg: "bg-green-600" },
  ];
  const row2Cards = [
    { title: "Total agents", value: totalAgents ?? 0, icon: Users, cardBg: "bg-indigo-600" },
    { title: "Total registrations", value: totalRegistrations ?? 0, icon: FileText, cardBg: "bg-purple-600" },
    { title: "Total earnings", value: `KSh ${(totalEarnings ?? 0).toLocaleString()}`, icon: DollarSign, cardBg: "bg-teal-600" },
  ];

  return (
    <div className="space-y-6 -mt-7 -ml-2">
      <DashboardRealtime />
      <div className="flex flex-row items-center gap-2">
        <Image src={"/dashboard.png"} alt="dashboard icon" height={22} width={22}/>
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          Dashboard
        </h1>
      </div>

      {/* Row 1 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {row1Cards.map(({ title, value, icon: Icon, cardBg }) => (
          <Card
            key={title}
            className={`relative gap-0 overflow-hidden rounded-none border-0 ${cardBg} py-4 shadow-sm transition-all hover:shadow-md`}
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
        ))}
      </div>

      {/* Row 2 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {row2Cards.map(({ title, value, icon: Icon, cardBg }) => (
          <Card
            key={title}
            className={`relative gap-0 overflow-hidden rounded-none border-0 ${cardBg} py-4 shadow-sm transition-all hover:shadow-md`}
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
        ))}
      </div>

      <DashboardCharts
        registrationsByDay={registrationsByDay}
        revenueByDay={revenueByDay}
        packageMix={packageMix}
      />
    </div>
  );
}
