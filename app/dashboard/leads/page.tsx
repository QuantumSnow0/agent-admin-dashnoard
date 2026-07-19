import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { LeadsView } from "@/components/leads/leads-view";
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
  let serviceConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (serviceConfigured) {
    try {
      const service = createServiceClient();
      const [leadsResult, tabCounts] = await Promise.all([
        fetchAdminInboundLeads(service, { statusFilter, searchQuery }),
        fetchLeadTabCounts(service),
      ]);
      leads = leadsResult.leads;
      error = leadsResult.error;
      counts = tabCounts;
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load leads";
      serviceConfigured = false;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Inbound leads</h1>
        <p className="mt-1 text-sm text-gray-600">
          Dispatch queue and active field work. Install proof review and KSh 200
          commission →{" "}
          <a
            href="/dashboard/lead-installations"
            className="font-medium text-indigo-600 hover:text-indigo-800"
          >
            Lead installations
          </a>{" "}
          (same workflow as Registrations).
        </p>
      </div>

      <LeadsView
        leads={leads}
        error={error}
        statusFilter={statusFilter}
        searchQuery={searchQuery}
        counts={counts}
        serviceConfigured={serviceConfigured}
      />
    </div>
  );
}
