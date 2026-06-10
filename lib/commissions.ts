export const STANDARD_COMMISSION = 500;
export const PREMIUM_COMMISSION = 700;

export function normalizeUnitsRequired(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(99, Math.floor(n));
}

/** Airtel commission for one registration (package rate × units). */
export function getAirtelCommissionKesForRegistration(row: {
  preferred_package?: string | null;
  units_required?: number | null;
}): number {
  const units = normalizeUnitsRequired(row.units_required);
  const rate =
    row.preferred_package === "premium" ? PREMIUM_COMMISSION : STANDARD_COMMISSION;
  return units * rate;
}

const AGENT_COMMISSION_SHARE = 0.3;
const MIN_COMMISSION_KES = 1000;

const SAFARICOM_DEAL_PRICE_KES: Record<string, number> = {
  fiber_40: 2999,
  fiber_60: 4100,
  fiber_150: 6299,
  fiber_500: 12499,
  fiber_1000: 20000,
  portable_15: 2999,
  portable_50: 4000,
  portable_100: 5000,
  portable_250: 10000,
  dedicated_100: 26680,
  dedicated_155: 48024,
  dedicated_200: 61364,
  dedicated_250: 76304.8,
  dedicated_300: 90712,
  dedicated_350: 105386,
};

export function getSafaricomDealPriceKes(dealId: string | null | undefined): number {
  if (!dealId) return 0;
  return SAFARICOM_DEAL_PRICE_KES[dealId] ?? 0;
}

export function getSafaricomCommissionKesForRegistration(row: {
  service_package?: string | null;
  fiber_deal_id?: string | null;
  portable_deal_id?: string | null;
  dedicated_wifi_deal_id?: string | null;
}): number {
  let dealId: string | null = null;
  const pkg = (row.service_package ?? "").trim();
  if (pkg === "home_business_fiber") {
    dealId = row.fiber_deal_id ?? null;
  } else if (pkg === "safaricom_portable_5g") {
    dealId = row.portable_deal_id ?? null;
  } else if (pkg === "safaricom_dedicated_wifi") {
    dealId = row.dedicated_wifi_deal_id ?? null;
  }

  const price = getSafaricomDealPriceKes(dealId);
  if (price <= 0) return 0;
  const percentCommission = Math.round(price * AGENT_COMMISSION_SHARE);
  return Math.max(MIN_COMMISSION_KES, percentCommission);
}

