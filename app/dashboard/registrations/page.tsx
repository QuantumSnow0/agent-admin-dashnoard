import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { RegistrationsTabsWrapper } from "@/components/registrations/registrations-tabs-wrapper";

// Force dynamic rendering for searchParams
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RegistrationsPageProps {
  searchParams: Promise<{
    status?: string;
  }>;
}

export default async function RegistrationsPage({ searchParams }: RegistrationsPageProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=not_authenticated");
  }

  // Verify user is admin
  const { data: agent } = await supabase
    .from("agents")
    .select("is_admin, name, email")
    .eq("id", user.id)
    .single();

  if (!agent || !agent.is_admin) {
    redirect("/login?error=admin_access_required");
  }

  // Await searchParams (Next.js 15+)
  const params = await searchParams;
  
  // Get status filter from URL params
  const statusFilter = params.status || "all";

  // Build query - apply filter before executing
  let registrationsQuery = supabase
    .from("customer_registrations")
    .select(`
      id,
      agent_id,
      customer_name,
      email,
      airtel_number,
      alternate_number,
      preferred_package,
      installation_town,
      delivery_landmark,
      installation_location,
      visit_date,
      visit_time,
      status,
      created_at,
      updated_at,
      ms_forms_response_id,
      ms_forms_submitted_at
    `)
    .order("created_at", { ascending: false });

  // Apply status filter if not "all"
  if (statusFilter !== "all") {
    registrationsQuery = registrationsQuery.eq("status", statusFilter);
  }

  const { data: registrations, error } = await registrationsQuery;

  // Get counts for each status
  const [
    { count: totalCount },
    { count: pendingCount },
    { count: approvedCount },
    { count: installedCount },
  ] = await Promise.all([
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("status", "approved"),
    supabase.from("customer_registrations").select("*", { count: "exact", head: true }).eq("status", "installed"),
  ]);

  if (error) {
    console.error("Error fetching registrations:", error);
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "installed":
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Installed
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Approved
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
            <Clock className="mr-1 h-3 w-3" />
            Pending
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getPackageBadge = (packageType: string) => {
    return packageType === "premium" ? (
      <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">
        Premium
      </Badge>
    ) : (
      <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">
        Standard
      </Badge>
    );
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Customer Registrations
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            View and manage all customer registrations
          </p>
        </div>
        <Link href="/dashboard/registrations">
          <Button variant="outline">
            <FileText className="mr-2 h-4 w-4" />
            All Registrations
          </Button>
        </Link>
      </div>

      {/* Status Tabs */}
      <RegistrationsTabsWrapper
        key={statusFilter}
        statusFilter={statusFilter}
        counts={{
          all: totalCount ?? 0,
          pending: pendingCount ?? 0,
          approved: approvedCount ?? 0,
          installed: installedCount ?? 0,
        }}
      >
        {error ? (
          <Card>
            <CardContent className="py-8 text-center text-red-600">
              Error loading registrations: {error.message}
            </CardContent>
          </Card>
        ) : !registrations || registrations.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-4 text-lg font-semibold text-gray-900">
                No registrations found
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                {statusFilter === "all"
                  ? "No customer registrations have been submitted yet."
                  : `No registrations with status "${statusFilter}" found.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {registrations.map((registration: any) => (
              <Card
                key={registration.id}
                className="border-gray-200 transition-shadow hover:shadow-md"
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: Registration Info */}
                    <div className="flex items-start space-x-4 flex-1 min-w-0">
                      {/* Avatar */}
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 font-semibold">
                        {getInitials(registration.customer_name)}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1">
                          <h3 className="text-lg font-semibold text-gray-900 truncate">
                            {registration.customer_name}
                          </h3>
                          {getStatusBadge(registration.status)}
                          {getPackageBadge(registration.preferred_package)}
                        </div>
                        <p className="text-sm text-gray-600 truncate mb-2">
                          {registration.email}
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                          {registration.airtel_number && (
                            <span className="whitespace-nowrap">📱 Airtel: {registration.airtel_number}</span>
                          )}
                          {registration.alternate_number && (
                            <span className="whitespace-nowrap">📱 Alt: {registration.alternate_number}</span>
                          )}
                          {registration.installation_town && (
                            <span className="whitespace-nowrap">📍 {registration.installation_town}</span>
                          )}
                          {registration.delivery_landmark && (
                            <span className="whitespace-nowrap">🏠 {registration.delivery_landmark}</span>
                          )}
                          <span className="whitespace-nowrap">
                            🕒 {new Date(registration.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {registration.visit_date && registration.visit_time && (
                          <div className="text-xs text-gray-600 mb-1">
                            📅 Visit: {registration.visit_date} at {registration.visit_time}
                          </div>
                        )}
                        {registration.agent_id && (
                          <div className="text-xs text-gray-600">
                            👤 Agent ID: <strong>{registration.agent_id.slice(0, 8)}...</strong>
                          </div>
                        )}
                        {registration.installation_location && (
                          <div className="text-xs text-gray-500 mt-1">
                            📍 Location: {registration.installation_location}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </RegistrationsTabsWrapper>
    </div>
  );
}
