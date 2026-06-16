import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/utils/super-admin";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  SuperAdminAgentDetail,
  SuperAdminRegistrationDetail,
} from "@/lib/super-admin-types";

const REGISTRATION_SELECT = `
  id,
  agent_id,
  customer_name,
  airtel_number,
  alternate_number,
  email,
  preferred_package,
  units_required,
  installation_town,
  delivery_landmark,
  installation_location,
  visit_date,
  visit_time,
  status,
  created_at,
  updated_at,
  ms_forms_response_id,
  ms_forms_submitted_at,
  agents(
    id,
    name,
    email,
    airtel_phone,
    safaricom_phone,
    town,
    area,
    status,
    created_at,
    total_earnings,
    available_balance
  )
`;

function mapAgent(raw: Record<string, unknown> | null): SuperAdminAgentDetail | null {
  if (!raw) return null;
  return {
    id: String(raw.id ?? ""),
    name: (raw.name as string | null) ?? null,
    email: (raw.email as string | null) ?? null,
    airtel_phone: (raw.airtel_phone as string | null) ?? null,
    safaricom_phone: (raw.safaricom_phone as string | null) ?? null,
    town: (raw.town as string | null) ?? null,
    area: (raw.area as string | null) ?? null,
    status: (raw.status as string | null) ?? null,
    created_at: (raw.created_at as string | null) ?? null,
    total_earnings:
      raw.total_earnings != null ? Number(raw.total_earnings) : null,
    available_balance:
      raw.available_balance != null ? Number(raw.available_balance) : null,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin();
  } catch (err: unknown) {
    const code = err instanceof Error ? err.message : "";
    if (code === "NOT_AUTHENTICATED") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Super admin access required" },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing registration id" }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("customer_registrations")
      .select(REGISTRATION_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    }

    const row = data as Record<string, unknown>;
    const agentsRaw = row.agents as Record<string, unknown> | Record<string, unknown>[] | null;
    const agentObj = Array.isArray(agentsRaw) ? agentsRaw[0] : agentsRaw;

    const detail: SuperAdminRegistrationDetail = {
      id: String(row.id),
      agent_id: String(row.agent_id),
      customer_name: String(row.customer_name ?? ""),
      airtel_number: (row.airtel_number as string | null) ?? null,
      alternate_number: (row.alternate_number as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      preferred_package: (row.preferred_package as string | null) ?? null,
      units_required:
        row.units_required != null ? Number(row.units_required) : null,
      installation_town: (row.installation_town as string | null) ?? null,
      delivery_landmark: (row.delivery_landmark as string | null) ?? null,
      installation_location: (row.installation_location as string | null) ?? null,
      visit_date: (row.visit_date as string | null) ?? null,
      visit_time: (row.visit_time as string | null) ?? null,
      status: String(row.status ?? ""),
      created_at: String(row.created_at ?? ""),
      updated_at: (row.updated_at as string | null) ?? null,
      ms_forms_response_id: (row.ms_forms_response_id as string | null) ?? null,
      ms_forms_submitted_at: (row.ms_forms_submitted_at as string | null) ?? null,
      agent: mapAgent(agentObj as Record<string, unknown> | null),
    };

    return NextResponse.json({ detail });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load details";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
