import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { LeadsView } from "@/components/leads/leads-view";
import { DefaultRadiusControl } from "@/components/dispatch/default-radius-control";
import { LeadGenCommissionControl } from "@/components/dispatch/lead-gen-commission-control";
import { DISPATCH_DEFAULTS } from "@/lib/dispatch/constants";
import {
  fetchAdminInboundLeads,
  fetchLeadTabCounts,
} from "@/lib/admin-leads";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LeadsPageProps = {
  searchParams: Promise<{ status?: string; q?: string }>;
};

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const supabase = await createClient();
  const params = await searchParams;
  const statusFilter = params.status || "queue";
  const searchQuery = (params.q ?? "").trim();

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

  let leads: Awaited<ReturnType<typeof fetchAdminInboundLeads>>["leads"] = [];
  let error: string | null = null;
  let counts = {
    queue: 0,
    active: 0,
    overdue: 0,
    installations: 0,
    closed: 0,
    all: 0,
  };
  let defaultRadiusKm: number = DISPATCH_DEFAULTS.defaultServiceRadiusKm;
  let leadSubmitterStandardKes = 0;
  let leadSubmitterPremiumKes = 0;
  let leadReceiverStandardKes = 0;
  let leadReceiverPremiumKes = 0;
  let serviceConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (serviceConfigured) {
    try {
      const service = createServiceClient();
      const [leadsResult, tabCounts, configRes] = await Promise.all([
        fetchAdminInboundLeads(service, { statusFilter, searchQuery }),
        fetchLeadTabCounts(service),
        service
          .from("dispatch_config")
          .select(
            "default_service_radius_km, lead_submitter_commission_kes, lead_receiver_commission_kes, lead_submitter_commission_standard_kes, lead_submitter_commission_premium_kes, lead_receiver_commission_standard_kes, lead_receiver_commission_premium_kes",
          )
          .limit(1)
          .maybeSingle(),
      ]);
      leads = leadsResult.leads;
      error = leadsResult.error;
      counts = tabCounts;
      const radius = Number(configRes.data?.default_service_radius_km);
      if (Number.isFinite(radius) && radius > 0) defaultRadiusKm = radius;

      const submitterStd = Number(
        configRes.data?.lead_submitter_commission_standard_kes ??
          configRes.data?.lead_submitter_commission_kes,
      );
      const submitterPrem = Number(
        configRes.data?.lead_submitter_commission_premium_kes ??
          configRes.data?.lead_submitter_commission_kes,
      );
      const receiverStd = Number(
        configRes.data?.lead_receiver_commission_standard_kes ??
          configRes.data?.lead_receiver_commission_kes,
      );
      const receiverPrem = Number(
        configRes.data?.lead_receiver_commission_premium_kes ??
          configRes.data?.lead_receiver_commission_kes,
      );
      if (Number.isFinite(submitterStd) && submitterStd >= 0) {
        leadSubmitterStandardKes = submitterStd;
      }
      if (Number.isFinite(submitterPrem) && submitterPrem >= 0) {
        leadSubmitterPremiumKes = submitterPrem;
      }
      if (Number.isFinite(receiverStd) && receiverStd >= 0) {
        leadReceiverStandardKes = receiverStd;
      }
      if (Number.isFinite(receiverPrem) && receiverPrem >= 0) {
        leadReceiverPremiumKes = receiverPrem;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load leads";
      serviceConfigured = false;
    }
  }

  const receiverFees = {
    standard: leadReceiverStandardKes,
    premium: leadReceiverPremiumKes,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Inbound leads</h1>
        <p className="mt-1 text-sm text-gray-600">
          Dispatch queue and active field work. Non-installer lead fees are set
          below by package (0 = hidden in the app). Website lead install fee
          stays KSh 200 — review installs on{" "}
          <a
            href="/dashboard/lead-installations"
            className="font-medium text-indigo-600 hover:text-indigo-800"
          >
            Lead installations
          </a>
          .
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DefaultRadiusControl initialRadiusKm={defaultRadiusKm} />
        <LeadGenCommissionControl
          initialSubmitterStandardKes={leadSubmitterStandardKes}
          initialSubmitterPremiumKes={leadSubmitterPremiumKes}
          initialReceiverStandardKes={leadReceiverStandardKes}
          initialReceiverPremiumKes={leadReceiverPremiumKes}
        />
      </div>

      <LeadsView
        leads={leads}
        error={error}
        statusFilter={statusFilter}
        searchQuery={searchQuery}
        counts={counts}
        serviceConfigured={serviceConfigured}
        receiverFees={receiverFees}
      />
    </div>
  );
}
