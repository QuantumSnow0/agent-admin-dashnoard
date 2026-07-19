import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, Wallet, TrendingUp, Users, Package, Sparkles, Bell } from "lucide-react";
import { AgentActions } from "@/components/agents/agent-actions";
import { AgentDispatchScopeControl } from "@/components/agents/agent-dispatch-scope";
import { AgentFallbackDispatchControl } from "@/components/agents/agent-fallback-dispatch";
import { AgentRatingStars } from "@/components/agents/agent-rating-stars";
import { AgentCustomersRegistered } from "@/components/agents/agent-customers-registered";
import { AgentPaymentManager } from "@/components/agents/agent-payment-manager";
import {
  getEffectiveCommissionPackage,
  getEffectiveCommissionUnits,
} from "@/lib/airtel-commission-effective";
import {
  computeAgentWalletSummary,
  fetchCommissionRates,
} from "@/lib/agent-wallet";
import {
  mapCustomerRegistrationToAdminRow,
  mapSafaricomRegistrationToAdminRow,
  mergeRegistrationsByDate,
  CUSTOMER_REGISTRATION_ADMIN_SELECT,
  SAFARICOM_REGISTRATION_ADMIN_SELECT,
} from "@/lib/admin-registrations";

interface AgentProfilePageProps {
  params: Promise<{ id: string }>;
}

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  rejected: "bg-orange-100 text-orange-800 border-orange-200",
  banned: "bg-red-100 text-red-800 border-red-200",
};

export default async function AgentProfilePage({ params }: AgentProfilePageProps) {
  const supabase = await createClient();
  const { id } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=not_authenticated");
  }

  const { data: currentUser } = await supabase
    .from("agents")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!currentUser?.is_admin) {
    redirect("/login?error=admin_access_required");
  }

  const { data: agent, error } = await supabase
    .from("agents")
    .select("id, name, email, airtel_phone, safaricom_phone, town, area, status, created_at, total_earnings, available_balance, lead_dispatch_scope, is_fallback_agent, fallback_priority")
    .eq("id", id)
    .single();

  if (error || !agent) {
    notFound();
  }

  const [
    { count: custRegCount },
    { count: safRegCount },
    { data: airtelInstalledRows },
    { data: customerRegs },
    { data: safaricomRegs },
    { data: paymentRows, error: paymentRowsError },
    { data: safInstalledRows, error: safInstalledRowsError },
    { data: leadInstallRows, error: leadInstallRowsError },
    { data: appRating },
    commissionRates,
  ] = await Promise.all([
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("agent_id", id).eq("commission_exempt", false),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("agent_id", id),
    supabase
      .from("customer_registrations")
      .select("preferred_package, units_required, commission_package, commission_units")
      .eq("agent_id", id)
      .eq("status", "installed")
      .eq("commission_exempt", false),
    supabase
      .from("customer_registrations")
      .select(CUSTOMER_REGISTRATION_ADMIN_SELECT)
      .eq("agent_id", id)
      .eq("commission_exempt", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("safaricom_registrations")
      .select(SAFARICOM_REGISTRATION_ADMIN_SELECT)
      .eq("agent_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("agent_payments")
      .select("amount_ksh")
      .eq("agent_id", id),
    supabase
      .from("safaricom_registrations")
      .select("service_package, fiber_deal_id, portable_deal_id, dedicated_wifi_deal_id")
      .eq("agent_id", id)
      .eq("status", "installed"),
    supabase
      .from("inbound_leads")
      .select("commission_earned_ksh, status")
      .eq("assigned_agent_id", id)
      .eq("status", "installed"),
    supabase
      .from("app_ratings")
      .select("score, created_at, opened_play_store")
      .eq("agent_id", id)
      .maybeSingle(),
    fetchCommissionRates(supabase),
  ]);

  const totalRegistrations = (custRegCount ?? 0) + (safRegCount ?? 0);
  const installedPremiumUnits = (airtelInstalledRows ?? [])
    .filter((r) => getEffectiveCommissionPackage(r) === "premium")
    .reduce((sum, r) => sum + getEffectiveCommissionUnits(r), 0);
  const installedStandardUnits = (airtelInstalledRows ?? [])
    .filter((r) => getEffectiveCommissionPackage(r) === "standard")
    .reduce((sum, r) => sum + getEffectiveCommissionUnits(r), 0);
  const wallet = computeAgentWalletSummary({
    airtelInstalledRows: airtelInstalledRows ?? [],
    safaricomInstalledRows:
      safInstalledRowsError || !safInstalledRows ? [] : safInstalledRows,
    leadInstallRows:
      leadInstallRowsError || !leadInstallRows ? [] : leadInstallRows,
    paymentRows: paymentRowsError || !paymentRows ? [] : paymentRows,
    rates: commissionRates,
  });
  const {
    totalEarnedKsh: computedTotalEarningsKsh,
    paidFromLedgerKsh,
    currentBalanceKsh: computedBalanceKsh,
    leadInstallCommissionKsh,
  } = wallet;
  const registrations = mergeRegistrationsByDate([
    ...(customerRegs ?? []).map((r) => mapCustomerRegistrationToAdminRow(r as Record<string, unknown>)),
    ...(safaricomRegs ?? []).map((r) => mapSafaricomRegistrationToAdminRow(r as Record<string, unknown>)),
  ]);

  const statusStyle = STATUS_STYLES[agent.status] ?? "bg-gray-100 text-gray-800 border-gray-200";
  const contactParts = [
    agent.email,
    agent.airtel_phone,
    agent.safaricom_phone,
    [agent.town, agent.area].filter(Boolean).join(", "),
  ].filter(Boolean);

  return (
    <div className="space-y-4 -ml-2 -mt-6">
      <Link
        href="/dashboard/agents"
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
      >
        <ChevronLeft className="h-4 w-4" />
        Agents
      </Link>

      {/* Single compact header – identity + all stats */}
      <header className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Row 1: Identity */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
            <Image src="/customer-service.png" alt="" height={22} width={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight text-gray-900">
                {agent.name || "Unnamed agent"}
              </h1>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusStyle}`}
              >
                {agent.status}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {contactParts.length ? contactParts.join(" · ") : "No contact info"}
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <Link
              href={`/dashboard/send-notification?agentId=${encodeURIComponent(agent.id)}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Bell className="h-3.5 w-3.5" />
              Send notification
            </Link>
            <AgentActions
              agent={{
                id: agent.id,
                name: agent.name ?? undefined,
                email: agent.email ?? "",
                status: agent.status,
              }}
            />
          </div>
        </div>

        {/* Row 2: Stats – earnings, balance, registrations */}
        <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-teal-600" />
              <span className="text-gray-500">Earnings</span>
              <span className="font-semibold tabular-nums text-gray-900">
                KSh {computedTotalEarningsKsh.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">Lead installs</span>
              <span className="font-semibold tabular-nums text-gray-900">
                KSh {leadInstallCommissionKsh.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
              <span className="text-gray-500">Balance</span>
              <span className="font-semibold tabular-nums text-gray-900">
                KSh {computedBalanceKsh.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 shrink-0 text-slate-600" />
              <span className="text-gray-500">Registered</span>
              <span className="font-semibold tabular-nums text-gray-900">
                {(totalRegistrations ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600" />
              <span className="text-gray-500">Premium units</span>
              <span className="font-semibold tabular-nums text-gray-900">
                {installedPremiumUnits.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span className="text-gray-500">Standard units</span>
              <span className="font-semibold tabular-nums text-gray-900">
                {installedStandardUnits.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500">App rating</span>
              <AgentRatingStars
                score={appRating?.score}
                variant="default"
                size="md"
                showScore
              />
              {appRating?.created_at ? (
                <span className="text-gray-400">
                  ·{" "}
                  {new Date(appRating.created_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {appRating.opened_play_store ? " · Play Store" : ""}
                </span>
              ) : null}
            </div>
          </div>
          <AgentPaymentManager
            agentId={agent.id}
            totalEarnings={computedTotalEarningsKsh}
            paidFromLedger={paidFromLedgerKsh}
            currentBalance={computedBalanceKsh}
          />
        </div>
      </header>

      <AgentDispatchScopeControl
        agentId={agent.id}
        initialScope={agent.lead_dispatch_scope ?? "both"}
      />

      <AgentFallbackDispatchControl
        agentId={agent.id}
        initialEnabled={Boolean(agent.is_fallback_agent)}
        initialPriority={Number(agent.fallback_priority ?? 100)}
      />

      <AgentCustomersRegistered registrations={registrations ?? []} />
    </div>
  );
}
