/** Unified admin list row: Airtel `customer_registrations` + Safaricom `safaricom_registrations`. */

export type AdminRegistrationSource = "airtel" | "safaricom";

/** Extra columns loaded for the admin detail panel (optional on list-only usage). */
export type AdminRegistrationDetailFields = {
  updated_at?: string | null;
  /** Airtel */
  installation_location?: string | null;
  ms_forms_response_id?: string | null;
  ms_forms_submitted_at?: string | null;
  /** Safaricom raw fields */
  identification_number?: string | null;
  date_of_birth?: string | null;
  fiber_deal_id?: string | null;
  portable_deal_id?: string | null;
  dedicated_wifi_deal_id?: string | null;
  fiber_region_name?: string | null;
  fiber_cluster_name?: string | null;
  fiber_estate_id?: string | null;
  fiber_estate_name?: string | null;
  install_county?: string | null;
  install_town?: string | null;
  install_landmark?: string | null;
};

export type AdminRegistrationListRow = {
  id: string;
  agent_id: string;
  source: AdminRegistrationSource;
  customer_name: string | null;
  email: string | null;
  airtel_number: string | null;
  alternate_number: string | null;
  /** Safaricom MSISDN (only when `source` is safaricom). */
  safaricom_number?: string | null;
  /** Raw `service_package` when `source` is safaricom (for UI badges). */
  safaricom_service_package?: string | null;
  preferred_package: string;
  /** Airtel only — devices/units (MS Forms totalUnitsRequired). Safaricom: null. */
  units_required?: number | null;
  /** Admin override for commission (NULL = use preferred_package). */
  commission_package?: string | null;
  /** Admin override for commission units (NULL = use units_required). */
  commission_units?: number | null;
  installation_town: string | null;
  delivery_landmark: string | null;
  visit_date: string | null;
  visit_time: string | null;
  status: string;
  created_at: string | null;
  agents: { name: string | null }[] | { name: string | null } | null;
};

/** Full row for registrations table + detail panel. */
export type AdminRegistrationRow = AdminRegistrationListRow & AdminRegistrationDetailFields;

/** Supabase select for Airtel rows (list + detail panel). */
export const CUSTOMER_REGISTRATION_ADMIN_SELECT = `
  id,
  agent_id,
  customer_name,
  email,
  airtel_number,
  alternate_number,
  preferred_package,
  units_required,
  commission_package,
  commission_units,
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
  agents(name)
`;

/** Supabase select for Safaricom rows (list + detail panel). */
export const SAFARICOM_REGISTRATION_ADMIN_SELECT = `
  id,
  agent_id,
  customer_name,
  email,
  safaricom_number,
  alternate_number,
  identification_number,
  date_of_birth,
  service_package,
  fiber_deal_id,
  portable_deal_id,
  dedicated_wifi_deal_id,
  fiber_region_name,
  fiber_cluster_name,
  fiber_estate_id,
  fiber_estate_name,
  install_county,
  install_town,
  install_landmark,
  status,
  created_at,
  updated_at,
  agents(name)
`;

const SAF_SERVICE_LABEL: Record<string, string> = {
  home_business_fiber: "Home & business fibre",
  safaricom_portable_5g: "Portable 5G",
  safaricom_dedicated_wifi: "Dedicated Wi-Fi",
};

function normPackageId(v: string | null | undefined): string {
  return (v ?? "").toString().trim().toLowerCase();
}

/** Read first non-empty string from a row (snake_case and camelCase keys). */
export function readRowString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

export function formatAirtelAdminLocation(row: {
  installation_town?: string | null;
  installation_location?: string | null;
  delivery_landmark?: string | null;
}): string | null {
  const parts = [row.installation_town, row.installation_location, row.delivery_landmark].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0
  );
  return parts.length ? parts.join(" · ") : null;
}

export function formatSafaricomAdminLocation(row: {
  service_package: string;
  fiber_region_name?: string | null;
  fiber_cluster_name?: string | null;
  install_town?: string | null;
  install_county?: string | null;
  install_landmark?: string | null;
}): string | null {
  const fiberParts = [row.fiber_region_name, row.fiber_cluster_name].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0
  );
  // Prefer fibre line whenever region/cluster exist (covers package casing drift and legacy rows).
  if (fiberParts.length) return fiberParts.join(" · ");

  const pkg = normPackageId(row.service_package);
  if (pkg === "safaricom_portable_5g" || pkg === "safaricom_dedicated_wifi") {
    const t = [row.install_county, row.install_town, row.install_landmark].filter(
      (p): p is string => typeof p === "string" && p.trim().length > 0
    );
    return t.length ? t.join(" · ") : null;
  }

  const t = [row.install_county, row.install_town, row.install_landmark].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0
  );
  return t.length ? t.join(" · ") : null;
}

export function mapCustomerRegistrationToAdminRow(reg: Record<string, unknown>): AdminRegistrationRow {
  const r = reg as Record<string, unknown> & {
    id: string;
    agent_id: string;
    customer_name: string | null;
    email: string | null;
    airtel_number: string | null;
    alternate_number: string | null;
    preferred_package: string;
    units_required?: number | null;
    installation_town: string | null;
    delivery_landmark: string | null;
    visit_date: string | null;
    visit_time: string | null;
    status: string;
    created_at: string | null;
    agents?: AdminRegistrationListRow["agents"];
  };
  return {
    id: r.id,
    agent_id: r.agent_id,
    customer_name: r.customer_name,
    email: r.email,
    airtel_number: r.airtel_number,
    alternate_number: r.alternate_number,
    preferred_package: r.preferred_package,
    units_required:
      r.units_required != null ? Number(r.units_required) || 1 : 1,
    commission_package: (r.commission_package as string | null) ?? null,
    commission_units:
      r.commission_units != null ? Number(r.commission_units) : null,
    installation_town: r.installation_town,
    delivery_landmark: r.delivery_landmark,
    visit_date: r.visit_date,
    visit_time: r.visit_time,
    status: r.status,
    created_at: r.created_at,
    agents: r.agents ?? null,
    source: "airtel",
    safaricom_number: null,
    safaricom_service_package: null,
    updated_at: (r.updated_at as string | null) ?? null,
    installation_location: (r.installation_location as string | null) ?? null,
    ms_forms_response_id: (r.ms_forms_response_id as string | null) ?? null,
    ms_forms_submitted_at: (r.ms_forms_submitted_at as string | null) ?? null,
  };
}

export function mapSafaricomRegistrationToAdminRow(reg: Record<string, unknown>): AdminRegistrationRow {
  const o = reg as Record<string, unknown>;

  const id = readRowString(o, "id") ?? "";
  const agent_id = readRowString(o, "agent_id", "agentId") ?? "";
  const customer_name = readRowString(o, "customer_name", "customerName");
  const email = readRowString(o, "email");
  const alternate_number = readRowString(o, "alternate_number", "alternateNumber");
  const safaricom_number = readRowString(o, "safaricom_number", "safaricomNumber");
  const service_package = readRowString(o, "service_package", "servicePackage") ?? "";
  const status = readRowString(o, "status") ?? "pending";
  const created_at = readRowString(o, "created_at", "createdAt");
  const updated_at = readRowString(o, "updated_at", "updatedAt");
  const identification_number = readRowString(o, "identification_number", "identificationNumber");
  const date_of_birth = readRowString(o, "date_of_birth", "dateOfBirth");
  const fiber_deal_id = readRowString(o, "fiber_deal_id", "fiberDealId");
  const portable_deal_id = readRowString(o, "portable_deal_id", "portableDealId");
  const dedicated_wifi_deal_id = readRowString(o, "dedicated_wifi_deal_id", "dedicatedWifiDealId");
  const fiber_region_name = readRowString(o, "fiber_region_name", "fiberRegionName");
  const fiber_cluster_name = readRowString(o, "fiber_cluster_name", "fiberClusterName");
  const fiber_estate_id = readRowString(o, "fiber_estate_id", "fiberEstateId");
  const fiber_estate_name = readRowString(o, "fiber_estate_name", "fiberEstateName");
  const install_county = readRowString(o, "install_county", "installCounty");
  const install_town = readRowString(o, "install_town", "installTown");
  const install_landmark = readRowString(o, "install_landmark", "installLandmark");

  const agents = (o.agents ?? null) as AdminRegistrationListRow["agents"];

  const loc = formatSafaricomAdminLocation({
    service_package,
    fiber_region_name,
    fiber_cluster_name,
    install_town,
    install_county,
    install_landmark,
  });

  const pkgKey = normPackageId(service_package);
  const preferred_package =
    (SAF_SERVICE_LABEL as Record<string, string>)[pkgKey] ?? service_package;

  return {
    id,
    agent_id,
    source: "safaricom",
    customer_name,
    email,
    airtel_number: null,
    alternate_number,
    safaricom_number,
    preferred_package,
    units_required: null,
    installation_town: loc,
    delivery_landmark: null,
    visit_date: null,
    visit_time: null,
    status,
    created_at,
    agents,
    safaricom_service_package: service_package,
    updated_at,
    identification_number,
    date_of_birth,
    fiber_deal_id,
    portable_deal_id,
    dedicated_wifi_deal_id,
    fiber_region_name,
    fiber_cluster_name,
    fiber_estate_id,
    fiber_estate_name,
    install_county,
    install_town,
    install_landmark,
  };
}

export function mergeRegistrationsByDate(rows: AdminRegistrationRow[]): AdminRegistrationRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
}
