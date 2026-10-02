/**
 * Inbound-lead payment display.
 * Keep in sync with airtel-agent-app/lib/commissions/leadInstallCommission.ts
 *
 * Approved payment is the custom amount stored on the lead. There is no
 * fixed website-lead fee.
 */

export type LeadPackageFeeKey = "standard" | "premium";

export type LeadPackageFees = {
  standard: number;
  premium: number;
};

export function normalizeLeadPackage(
  raw?: string | null,
): LeadPackageFeeKey {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return value === "premium" || value.includes("premium")
    ? "premium"
    : "standard";
}

export function pickPackageFee(
  fees: LeadPackageFees | null | undefined,
  preferredPackage?: string | null,
): number {
  const key = normalizeLeadPackage(preferredPackage);
  const n = Number(fees?.[key] ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

export function isAgentSubmittedLead(row: {
  source?: string | null;
  submitted_by_agent_id?: string | null;
}): boolean {
  return (
    row.source === "agent_own" ||
    (row.submitted_by_agent_id != null &&
      String(row.submitted_by_agent_id).length > 0)
  );
}

/** Amount to show in UI, or null to hide. */
export function resolveLeadInstallDisplayKes(opts: {
  source?: string | null;
  submitted_by_agent_id?: string | null;
  preferredPackage?: string | null;
  receiverFees?: LeadPackageFees | null;
  /** @deprecated prefer receiverFees + preferredPackage */
  receiverCommissionKes?: number | null;
}): number | null {
  if (isAgentSubmittedLead(opts)) {
    const fromPackage =
      opts.receiverFees != null
        ? pickPackageFee(opts.receiverFees, opts.preferredPackage)
        : 0;
    const legacy = Number(opts.receiverCommissionKes);
    const n =
      fromPackage > 0
        ? fromPackage
        : Number.isFinite(legacy) && legacy > 0
          ? Math.round(legacy)
          : 0;
    if (n <= 0) return null;
    return n;
  }
  return null;
}

/** Amount to store when admin confirms install (0 allowed for agent_own). */
export function resolveLeadInstallConfirmKes(opts: {
  source?: string | null;
  submitted_by_agent_id?: string | null;
  preferredPackage?: string | null;
  existingCommissionKes?: number | null;
  receiverFees?: LeadPackageFees | null;
  /** @deprecated prefer receiverFees + preferredPackage */
  receiverCommissionKes?: number | null;
}): number {
  const existing = Number(opts.existingCommissionKes);
  if (Number.isFinite(existing) && existing > 0) return Math.round(existing);
  if (isAgentSubmittedLead(opts)) {
    if (opts.receiverFees != null) {
      return pickPackageFee(opts.receiverFees, opts.preferredPackage);
    }
    const n = Number(opts.receiverCommissionKes);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n);
  }
  return 0;
}

export function getLeadInstallCommissionKes(row: {
  commission_earned_ksh?: number | string | null;
  status?: string | null;
}): number {
  // Commission only after payment is approved, or on older installed rows.
  if (
    row.status != null &&
    row.status !== "installed" &&
    row.status !== "approved"
  ) {
    return 0;
  }
  const stored = Number(row.commission_earned_ksh);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  return 0;
}
