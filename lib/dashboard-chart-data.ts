import { eachDayOfInterval, format, startOfDay, subDays } from "date-fns";
import {
  getAirtelCommissionKesForRegistration,
  getSafaricomCommissionKesForRegistration,
  normalizeUnitsRequired,
} from "@/lib/commissions";
import type { CommissionRates } from "@/lib/agent-wallet";
import { isClosedRegistrationStatus } from "@/lib/registration-statuses";

export type RegistrationsByDay = { date: string; count: number }[];
export type RevenueByDay = { date: string; revenue: number }[];
export type PackageMix = { name: string; value: number }[];
export type TopSellingAgent = {
  agent: string;
  airtel: number;
  safaricom: number;
  total: number;
};

export type ChartRangeData = {
  registrationsByDay: RegistrationsByDay;
  revenueByDay: RevenueByDay;
  packageMix: PackageMix;
  topSellingAgents: TopSellingAgent[];
  topInstalledAgents: TopSellingAgent[];
};

type DatedRow = { created_at: string | null };

type CustRegRow = DatedRow & {
  agent_id: string | null;
  status: string;
  preferred_package?: string | null;
  units_required?: number | null;
  commission_package?: string | null;
  commission_units?: number | null;
};

type SafRegRow = DatedRow & {
  agent_id: string | null;
  status: string;
  service_package?: string;
  fiber_deal_id?: string | null;
  portable_deal_id?: string | null;
  dedicated_wifi_deal_id?: string | null;
};

function inLastDays(createdAt: string | null | undefined, days: number): boolean {
  if (!createdAt) return false;
  return new Date(createdAt) >= subDays(new Date(), days);
}

function buildTopAgents(
  custRegs: CustRegRow[],
  safRegs: SafRegRow[],
  agents: { id: string; name: string | null; email: string | null }[],
  days: number,
  installedOnly: boolean
): TopSellingAgent[] {
  const counts = new Map<string, { airtel: number; safaricom: number }>();
  const filterRow = (row: CustRegRow | SafRegRow) => {
    if (!inLastDays(row.created_at, days)) return false;
    if (installedOnly && row.status !== "installed") return false;
    return true;
  };

  for (const row of custRegs) {
    if (!filterRow(row) || !row.agent_id) continue;
    const current = counts.get(row.agent_id) ?? { airtel: 0, safaricom: 0 };
    current.airtel += 1;
    counts.set(row.agent_id, current);
  }

  for (const row of safRegs) {
    if (!filterRow(row) || !row.agent_id) continue;
    const current = counts.get(row.agent_id) ?? { airtel: 0, safaricom: 0 };
    current.safaricom += 1;
    counts.set(row.agent_id, current);
  }

  const agentNameById = new Map(
    agents.map((a) => [a.id, a.name?.trim() || a.email || "Unknown agent"])
  );

  return [...counts.entries()]
    .map(([agentId, { airtel, safaricom }]) => ({
      agent: agentNameById.get(agentId) ?? "Unknown agent",
      airtel,
      safaricom,
      total: airtel + safaricom,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

export function buildChartRangeData(
  custRegs: CustRegRow[],
  safRegs: SafRegRow[],
  agents: { id: string; name: string | null; email: string | null }[],
  days: 7 | 30,
  rates?: CommissionRates
): ChartRangeData {
  const custInRange = custRegs.filter((r) => inLastDays(r.created_at, days));
  const safInRange = safRegs.filter((r) => inLastDays(r.created_at, days));
  const allInRange = [...custInRange, ...safInRange];

  const dayRange = eachDayOfInterval({
    start: subDays(new Date(), days - 1),
    end: new Date(),
  });

  const registrationsByDay = dayRange.map((day) => {
    const dayStart = startOfDay(day).getTime();
    const count = allInRange.filter(
      (r) => r.created_at && startOfDay(new Date(r.created_at)).getTime() === dayStart
    ).length;
    return { date: format(day, days <= 7 ? "EEE d" : "MMM d"), count };
  });

  const revenueByDay = dayRange.map((day) => {
    const dayStart = startOfDay(day).getTime();
    const dayCustInstalled = custInRange.filter(
      (r) =>
        r.status === "installed" &&
        r.created_at &&
        startOfDay(new Date(r.created_at)).getTime() === dayStart
    );
    const daySafInstalled = safInRange.filter(
      (r) =>
        r.status === "installed" &&
        r.created_at &&
        startOfDay(new Date(r.created_at)).getTime() === dayStart
    );

    const airtelRevenue = dayCustInstalled.reduce(
      (sum, r) => sum + getAirtelCommissionKesForRegistration(r, rates),
      0
    );
    const safRevenue = daySafInstalled.reduce(
      (sum, r) => sum + getSafaricomCommissionKesForRegistration(r),
      0
    );

    return { date: format(day, days <= 7 ? "EEE d" : "MMM d"), revenue: airtelRevenue + safRevenue };
  });

  const custInstalledInRange = custInRange.filter((r) => r.status === "installed");
  const safInstalledInRange = safInRange.filter((r) => r.status === "installed");
  const premiumCount = custInstalledInRange
    .filter((r) => r.preferred_package === "premium")
    .reduce((sum, r) => sum + normalizeUnitsRequired(r.units_required), 0);
  const standardCount = custInstalledInRange
    .filter((r) => r.preferred_package === "standard")
    .reduce((sum, r) => sum + normalizeUnitsRequired(r.units_required), 0);

  const packageMix: PackageMix = [
    { name: "Standard", value: standardCount },
    { name: "Premium", value: premiumCount },
    { name: "Safaricom", value: safInstalledInRange.length },
  ];

  return {
    registrationsByDay,
    revenueByDay,
    packageMix,
    topSellingAgents: buildTopAgents(custRegs, safRegs, agents, days, false),
    topInstalledAgents: buildTopAgents(custRegs, safRegs, agents, days, true),
  };
}

export function computeCommissionLiability(
  custInstalled: {
    preferred_package?: string | null;
    units_required?: number | null;
    commission_package?: string | null;
    commission_units?: number | null;
  }[],
  safInstalled: {
    service_package?: string;
    fiber_deal_id?: string | null;
    portable_deal_id?: string | null;
    dedicated_wifi_deal_id?: string | null;
  }[],
  paymentRows: { amount_ksh?: number | string | null }[],
  rates?: CommissionRates
) {
  const airtelEarned = custInstalled.reduce(
    (sum, row) => sum + getAirtelCommissionKesForRegistration(row, rates),
    0
  );
  const safaricomEarned = safInstalled.reduce(
    (sum, row) => sum + getSafaricomCommissionKesForRegistration(row),
    0
  );
  const totalEarned = airtelEarned + safaricomEarned;
  const totalPaid = Math.max(
    0,
    Math.round(
      paymentRows.reduce((sum, row) => sum + Number(row.amount_ksh ?? 0), 0)
    )
  );
  const outstanding = Math.max(0, totalEarned - totalPaid);

  return { totalEarned, totalPaid, outstanding };
}

export type ConversionFunnel = {
  registered: number;
  installed: number;
  closed: number;
  registeredToInstalledPct: number;
  closedPct: number;
};

export function buildConversionFunnel(
  custRegs: { status: string }[],
  safRegs: { status: string }[]
): ConversionFunnel {
  const all = [...custRegs, ...safRegs];
  const registered = all.length;
  const installed = all.filter((r) => r.status === "installed").length;
  const closed = all.filter((r) => isClosedRegistrationStatus(r.status)).length;

  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 100) : 0;

  return {
    registered,
    installed,
    closed,
    registeredToInstalledPct: pct(installed, registered),
    closedPct: pct(closed, registered),
  };
}

export function buildCarrierFunnel(
  regs: { status: string }[]
): ConversionFunnel {
  return buildConversionFunnel(regs, []);
}

export type GeographyBreakdownRow = {
  location: string;
  airtel: number;
  safaricom: number;
  total: number;
};

const UNKNOWN_LOCATION = "Unknown";

function normalizeLocationLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getAirtelRegistrationLocation(row: {
  installation_town?: string | null;
}): string {
  return normalizeLocationLabel(row.installation_town) ?? UNKNOWN_LOCATION;
}

export function getSafaricomRegistrationLocation(row: {
  service_package?: string | null;
  fiber_region_name?: string | null;
  fiber_cluster_name?: string | null;
  install_town?: string | null;
  install_county?: string | null;
}): string {
  const region = normalizeLocationLabel(row.fiber_region_name);
  if (region) return region;

  const cluster = normalizeLocationLabel(row.fiber_cluster_name);
  if (cluster) return cluster;

  const town = normalizeLocationLabel(row.install_town);
  if (town) return town;

  const county = normalizeLocationLabel(row.install_county);
  if (county) return county;

  return UNKNOWN_LOCATION;
}

function buildGeographyCounts(
  custRegs: {
    status: string;
    installation_town?: string | null;
  }[],
  safRegs: {
    status: string;
    service_package?: string | null;
    fiber_region_name?: string | null;
    fiber_cluster_name?: string | null;
    install_town?: string | null;
    install_county?: string | null;
  }[],
  installedOnly: boolean
): GeographyBreakdownRow[] {
  const counts = new Map<string, { airtel: number; safaricom: number }>();

  const bump = (location: string, carrier: "airtel" | "safaricom") => {
    const current = counts.get(location) ?? { airtel: 0, safaricom: 0 };
    current[carrier] += 1;
    counts.set(location, current);
  };

  for (const row of custRegs) {
    if (installedOnly && row.status !== "installed") continue;
    bump(getAirtelRegistrationLocation(row), "airtel");
  }

  for (const row of safRegs) {
    if (installedOnly && row.status !== "installed") continue;
    bump(getSafaricomRegistrationLocation(row), "safaricom");
  }

  return [...counts.entries()]
    .map(([location, { airtel, safaricom }]) => ({
      location,
      airtel,
      safaricom,
      total: airtel + safaricom,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

export function buildGeographyBreakdown(
  custRegs: {
    status: string;
    installation_town?: string | null;
  }[],
  safRegs: {
    status: string;
    service_package?: string | null;
    fiber_region_name?: string | null;
    fiber_cluster_name?: string | null;
    install_town?: string | null;
    install_county?: string | null;
  }[]
) {
  return {
    registrationsByLocation: buildGeographyCounts(custRegs, safRegs, false),
    installedByLocation: buildGeographyCounts(custRegs, safRegs, true),
  };
}
