import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Clock, Package, XCircle } from "lucide-react";
import { REGISTRATION_CLOSED_STATUSES } from "@/lib/registration-statuses";
import Link from "next/link";
import { RegistrationsView } from "@/components/registrations/registrations-view";
import {
  mapCustomerRegistrationToAdminRow,
  mapSafaricomRegistrationToAdminRow,
  mergeRegistrationsByDate,
  CUSTOMER_REGISTRATION_ADMIN_SELECT,
  SAFARICOM_REGISTRATION_ADMIN_SELECT,
} from "@/lib/admin-registrations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function escapeSearch(q: string): string {
  return q.trim().replace(/'/g, "''");
}

interface RegistrationsPageProps {
  searchParams: Promise<{ status?: string; q?: string; agentId?: string }>;
}

const CUSTOMER_SELECT = CUSTOMER_REGISTRATION_ADMIN_SELECT;

const SAFARICOM_SELECT = SAFARICOM_REGISTRATION_ADMIN_SELECT;

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

  const { data: agent } = await supabase.from("agents").select("is_admin").eq("id", user.id).single();

  if (!agent?.is_admin) {
    redirect("/login?error=admin_access_required");
  }

  let customerQuery = supabase
    .from("customer_registrations")
    .select(CUSTOMER_SELECT)
    .eq("commission_exempt", false)
    .order("created_at", { ascending: false });

  let safaricomQuery = supabase
    .from("safaricom_registrations")
    .select(SAFARICOM_SELECT)
    .order("created_at", { ascending: false });

  if (statusFilter === "airtel_queue") {
    customerQuery = customerQuery.is("ms_forms_response_id", null);
  } else if (statusFilter === "closed") {
    customerQuery = customerQuery.in("status", REGISTRATION_CLOSED_STATUSES);
    safaricomQuery = safaricomQuery.in("status", REGISTRATION_CLOSED_STATUSES);
  } else if (statusFilter !== "all") {
    customerQuery = customerQuery.eq("status", statusFilter);
    safaricomQuery = safaricomQuery.eq("status", statusFilter);
  }
  if (agentIdFilter) {
    customerQuery = customerQuery.eq("agent_id", agentIdFilter);
    if (statusFilter !== "airtel_queue") {
      safaricomQuery = safaricomQuery.eq("agent_id", agentIdFilter);
    }
  }
  if (searchQuery) {
    const escaped = escapeSearch(searchQuery);
    customerQuery = customerQuery.or(
      `customer_name.ilike.%${escaped}%,email.ilike.%${escaped}%,airtel_number.ilike.%${escaped}%,alternate_number.ilike.%${escaped}%,installation_town.ilike.%${escaped}%,delivery_landmark.ilike.%${escaped}%`
    );
    if (statusFilter !== "airtel_queue") {
      safaricomQuery = safaricomQuery.or(
        `customer_name.ilike.%${escaped}%,email.ilike.%${escaped}%,safaricom_number.ilike.%${escaped}%,alternate_number.ilike.%${escaped}%,identification_number.ilike.%${escaped}%,date_of_birth.ilike.%${escaped}%,service_package.ilike.%${escaped}%,fiber_region_name.ilike.%${escaped}%,fiber_cluster_name.ilike.%${escaped}%,install_county.ilike.%${escaped}%,install_town.ilike.%${escaped}%,install_landmark.ilike.%${escaped}%`
      );
    }
  }

  const safaricomPromise =
    statusFilter === "airtel_queue"
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : safaricomQuery;

  const [
    { data: customerRows, error: customerError },
    { data: safaricomRows, error: safaricomError },
    { data: agentsList },
    { count: custTotal },
    { count: safTotal },
    { count: custPending },
    { count: safPending },
    { count: custRejected },
    { count: safRejected },
    { count: custDuplicate },
    { count: safDuplicate },
    { count: custCancelled },
    { count: safCancelled },
    { count: custInstalled },
    { count: safInstalled },
    { count: airtelQueueCount },
  ] = await Promise.all([
    customerQuery,
    safaricomPromise,
    supabase.from("agents").select("id, name").order("name", { ascending: true, nullsFirst: false }),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("commission_exempt", false),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("commission_exempt", false).eq("status", "pending"),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("commission_exempt", false).eq("status", "rejected"),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("status", "rejected"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("commission_exempt", false).eq("status", "duplicate"),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("status", "duplicate"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("commission_exempt", false).eq("status", "cancelled"),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("status", "cancelled"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("commission_exempt", false).eq("status", "installed"),
    supabase.from("safaricom_registrations").select("*", { count: "exact", head: true }).eq("status", "installed"),
    supabase
      .from("customer_registrations")
      .select("*", { count: "exact", head: true })
      .eq("commission_exempt", false)
      .is("ms_forms_response_id", null),
  ]);

  const totalCount = (custTotal ?? 0) + (safTotal ?? 0);
  const pendingCount = (custPending ?? 0) + (safPending ?? 0);
  const rejectedCount = (custRejected ?? 0) + (safRejected ?? 0);
  const duplicateCount = (custDuplicate ?? 0) + (safDuplicate ?? 0);
  const cancelledCount = (custCancelled ?? 0) + (safCancelled ?? 0);
  const closedCount = rejectedCount + duplicateCount + cancelledCount;
  const installedCount = (custInstalled ?? 0) + (safInstalled ?? 0);
  const airtelMsFormsQueueCount = airtelQueueCount ?? 0;

  const listError =
    statusFilter === "airtel_queue" ? customerError : customerError ?? safaricomError;
  if (listError) {
    console.error("Error fetching registrations:", listError);
  }

  const merged =
    statusFilter === "airtel_queue"
      ? mergeRegistrationsByDate([
          ...(customerRows ?? []).map((r) =>
            mapCustomerRegistrationToAdminRow(r as Record<string, unknown>),
          ),
        ])
      : mergeRegistrationsByDate([
          ...(customerRows ?? []).map((r) =>
            mapCustomerRegistrationToAdminRow(r as Record<string, unknown>),
          ),
          ...(safaricomRows ?? []).map((r) =>
            mapSafaricomRegistrationToAdminRow(r as Record<string, unknown>),
          ),
        ]);

  const countCards = [
    { title: "All", value: totalCount, href: "/dashboard/registrations", icon: FileText, cardBg: "bg-slate-600" },
    { title: "Pending", value: pendingCount, href: "/dashboard/registrations?status=pending", icon: Clock, cardBg: "bg-amber-600" },
    { title: "Installed", value: installedCount, href: "/dashboard/registrations?status=installed", icon: Package, cardBg: "bg-emerald-600" },
    { title: "Closed", value: closedCount, href: "/dashboard/registrations?status=closed", icon: XCircle, cardBg: "bg-gray-600" },
  ];

  return (
    <div className="space-y-4 -ml-2 -mt-6">
      <div className="flex flex-row items-center gap-2">
        <FileText className="h-6 w-6 text-gray-700" />
        <h1 className="text-xl font-bold tracking-tight text-gray-900">Customer Registrations</h1>
      </div>
      <p className="text-sm text-gray-600">
        Pending = awaiting outcome. Installed = commission earned. Use Rejected, Duplicate, or Cancelled when the order will not be installed.
        Airtel queue = not yet submitted to Microsoft Forms — submit from the detail panel if auto-submit fails.
      </p>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
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
        registrations={merged}
        error={listError ? new Error(listError.message) : null}
        statusFilter={statusFilter}
        searchQuery={searchQuery}
        agentIdFilter={agentIdFilter}
        agentsList={agentsList ?? []}
        counts={{
          all: totalCount,
          pending: pendingCount,
          installed: installedCount,
          closed: closedCount,
          rejected: rejectedCount,
          duplicate: duplicateCount,
          cancelled: cancelledCount,
          airtelQueue: airtelMsFormsQueueCount,
        }}
      />
    </div>
  );
}
