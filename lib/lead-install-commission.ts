/**
 * Flat commission for inbound-lead installations (KSh).
 * Keep in sync with airtel-agent-app/lib/commissions/leadInstallCommission.ts
 */

import { LEAD_INSTALL_COMMISSION_KES } from "@/lib/dispatch/constants";

export { LEAD_INSTALL_COMMISSION_KES };

export function getLeadInstallCommissionKes(
  row: { commission_earned_ksh?: number | string | null; status?: string | null },
): number {
  // Commission only after admin confirms (status installed + amount stored).
  if (row.status != null && row.status !== "installed") return 0;
  const stored = Number(row.commission_earned_ksh);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  return 0;
}
