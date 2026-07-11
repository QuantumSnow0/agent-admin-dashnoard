import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SuperAdminQueue } from "@/components/super-admin/super-admin-queue";
import { fetchMSFormsSubmissionMode } from "@/lib/ms-forms-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type SuperAdminQueueRow = {
  id: string;
  customer_name: string;
  airtel_number: string | null;
  preferred_package: string | null;
  installation_town: string | null;
  status: string;
  created_at: string;
  ms_forms_response_id: string | null;
  ms_forms_submitted_at: string | null;
  agent_name: string | null;
};

export default async function SuperAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=not_authenticated");
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("is_super_admin, name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (!agent?.is_super_admin) {
    redirect("/login?error=super_admin_access_required");
  }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let pending: SuperAdminQueueRow[] = [];
  let submitted: SuperAdminQueueRow[] = [];
  let submissionMode: "auto" | "manual" = "manual";
  let loadError: string | null = null;

  if (!serviceKey) {
    loadError = "SUPABASE_SERVICE_ROLE_KEY is not configured on the server.";
  } else {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const service = createServiceClient();

    const select = `
      id,
      customer_name,
      airtel_number,
      preferred_package,
      installation_town,
      status,
      created_at,
      ms_forms_response_id,
      ms_forms_submitted_at,
      agents(name)
    `;

    submissionMode = await fetchMSFormsSubmissionMode(service);

    const [pendingRes, submittedRes] = await Promise.all([
      service
        .from("customer_registrations")
        .select(select)
        .is("ms_forms_response_id", null)
        .order("created_at", { ascending: false })
        .limit(200),
      service
        .from("customer_registrations")
        .select(select)
        .not("ms_forms_response_id", "is", null)
        .order("ms_forms_submitted_at", { ascending: false })
        .limit(50),
    ]);

    if (pendingRes.error || submittedRes.error) {
      loadError =
        pendingRes.error?.message ??
        submittedRes.error?.message ??
        "Failed to load registrations";
    } else {
      const mapRow = (row: Record<string, unknown>): SuperAdminQueueRow => {
        const agents = row.agents as { name?: string } | { name?: string }[] | null;
        const agentName = Array.isArray(agents)
          ? agents[0]?.name ?? null
          : agents?.name ?? null;

        return {
          id: String(row.id),
          customer_name: String(row.customer_name ?? ""),
          airtel_number: (row.airtel_number as string | null) ?? null,
          preferred_package: (row.preferred_package as string | null) ?? null,
          installation_town: (row.installation_town as string | null) ?? null,
          status: String(row.status ?? ""),
          created_at: String(row.created_at ?? ""),
          ms_forms_response_id: (row.ms_forms_response_id as string | null) ?? null,
          ms_forms_submitted_at: (row.ms_forms_submitted_at as string | null) ?? null,
          agent_name: agentName,
        };
      };

      pending = (pendingRes.data ?? []).map(mapRow);
      submitted = (submittedRes.data ?? []).map(mapRow);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">MS Forms queue</h1>
        <p className="mt-1 text-sm text-slate-400">
          {submissionMode === "auto"
            ? "Automatic mode — agents with the latest app submit to MS Forms when they register. Pending here means an old app version or a failed submit — use Send to MS Forms."
            : "Manual mode — submit Airtel registrations to Microsoft Forms from the queue below."}
        </p>
        {agent.email ? (
          <p className="mt-1 text-xs text-slate-500">Signed in as {agent.email}</p>
        ) : null}
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </div>
      ) : (
        <SuperAdminQueue
          initialPending={pending}
          initialSubmitted={submitted}
          initialSubmissionMode={submissionMode}
        />
      )}

      {!serviceUrl ? (
        <p className="text-xs text-amber-600">
          Warning: NEXT_PUBLIC_SUPABASE_URL is missing.
        </p>
      ) : null}
    </div>
  );
}
