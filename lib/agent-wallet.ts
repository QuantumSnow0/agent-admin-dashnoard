import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAirtelCommissionKesForRegistration,
  getSafaricomCommissionKesForRegistration,
  STANDARD_COMMISSION,
  PREMIUM_COMMISSION,
} from "@/lib/commissions";
import type { AirtelCommissionBasisRow } from "@/lib/airtel-commission-effective";

export type CommissionRates = { standard: number; premium: number };

export type AirtelInstalledRow = AirtelCommissionBasisRow & {
  status?: string | null;
};

export type SafaricomInstalledRow = {
  service_package?: string | null;
  fiber_deal_id?: string | null;
  portable_deal_id?: string | null;
  dedicated_wifi_deal_id?: string | null;
};

export type PaymentLedgerRow = { amount_ksh?: number | string | null };

export type AgentWalletSummary = {
  airtelCommissionKsh: number;
  safaricomCommissionKsh: number;
  totalEarnedKsh: number;
  paidFromLedgerKsh: number;
  currentBalanceKsh: number;
};

export async function fetchCommissionRates(
  supabase: SupabaseClient
): Promise<CommissionRates> {
  const { data, error } = await supabase
    .from("commission_rates_config")
    .select("standard_commission, premium_commission")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("commission_rates_config unavailable, using fallbacks:", error.message);
  }

  return {
    standard: Number(data?.standard_commission) || STANDARD_COMMISSION,
    premium: Number(data?.premium_commission) || PREMIUM_COMMISSION,
  };
}

export function sumPaidFromLedger(paymentRows: PaymentLedgerRow[]): number {
  const total = paymentRows.reduce(
    (sum, row) => sum + Number(row.amount_ksh ?? 0),
    0
  );
  return Math.max(0, Math.round(total));
}

export function computeAgentWalletSummary(input: {
  airtelInstalledRows: AirtelInstalledRow[];
  safaricomInstalledRows: SafaricomInstalledRow[];
  paymentRows: PaymentLedgerRow[];
  rates: CommissionRates;
}): AgentWalletSummary {
  const { airtelInstalledRows, safaricomInstalledRows, paymentRows, rates } =
    input;

  const airtelCommissionKsh = airtelInstalledRows.reduce(
    (sum, row) =>
      sum +
      getAirtelCommissionKesForRegistration(
        { ...row, status: row.status ?? "installed" },
        rates
      ),
    0
  );

  const safaricomCommissionKsh = safaricomInstalledRows.reduce(
    (sum, row) => sum + getSafaricomCommissionKesForRegistration(row),
    0
  );

  const totalEarnedKsh = airtelCommissionKsh + safaricomCommissionKsh;
  const paidFromLedgerKsh = sumPaidFromLedger(paymentRows);
  const currentBalanceKsh = Math.max(0, totalEarnedKsh - paidFromLedgerKsh);

  return {
    airtelCommissionKsh,
    safaricomCommissionKsh,
    totalEarnedKsh,
    paidFromLedgerKsh,
    currentBalanceKsh,
  };
}
