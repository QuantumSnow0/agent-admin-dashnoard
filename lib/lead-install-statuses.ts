/**
 * Inbound lead install review statuses (mirror customer_registrations).
 *
 * pending_install = agent submitted proof and payment is waiting.
 * approved = custom amount plus M-Pesa reference.
 * denied = payment refused, with a reason.
 * installed = older rows confirmed before this review.
 */

import type { LeadPackageFees } from "@/lib/lead-install-commission";

export const LEAD_INSTALL_REVIEW_STATUSES = [
  "kyc_completed",
  "pending_install",
  "installed",
  "approved",
  "denied",
  "rejected",
  "duplicate",
  "cancelled",
] as const;

export type LeadInstallReviewStatus =
  (typeof LEAD_INSTALL_REVIEW_STATUSES)[number];

export const LEAD_INSTALL_CLOSED_STATUSES: LeadInstallReviewStatus[] = [
  "denied",
  "rejected",
  "duplicate",
  "cancelled",
];

export const LEAD_INSTALL_STATUS_STYLES: Record<string, string> = {
  kyc_completed: "bg-sky-100 text-sky-800 border-sky-200",
  pending_install: "bg-amber-100 text-amber-800 border-amber-200",
  installed: "bg-sky-100 text-sky-800 border-sky-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  denied: "bg-red-100 text-red-800 border-red-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  duplicate: "bg-violet-100 text-violet-800 border-violet-200",
  cancelled: "bg-gray-100 text-gray-800 border-gray-200",
};

export function isClosedLeadInstallStatus(status: string): boolean {
  return (LEAD_INSTALL_CLOSED_STATUSES as readonly string[]).includes(status);
}

export function formatLeadInstallStatusLabel(status: string): string {
  switch (status) {
    case "kyc_completed":
      return "KYC done";
    case "pending_install":
      return "Pending";
    case "installed":
      return "Installed";
    case "approved":
      return "Approved";
    case "denied":
      return "Denied";
    case "rejected":
      return "Rejected";
    case "duplicate":
      return "Duplicate";
    case "cancelled":
      return "Cancelled";
    default:
      return status
        .split("_")
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
  }
}

export function leadInstallCommissionLabel(
  status: string,
  opts?: {
    source?: string | null;
    submitted_by_agent_id?: string | null;
    preferredPackage?: string | null;
    commission_earned_ksh?: number | null;
    receiverFees?: LeadPackageFees | null;
    /** @deprecated use receiverFees */
    receiverCommissionKes?: number | null;
  },
): string {
  if (status === "approved" || status === "installed") {
    const stored = Number(opts?.commission_earned_ksh);
    if (Number.isFinite(stored) && stored > 0) {
      return `KSh ${Math.round(stored).toLocaleString()}`;
    }
    return "—";
  }
  if (status === "pending_install") {
    return "Waiting for confirmation";
  }
  if (status === "denied") {
    return "Denied";
  }
  if (status === "kyc_completed") {
    return "Awaiting install";
  }
  return "—";
}
