/**
 * Inbound lead install review statuses (mirror customer_registrations).
 *
 * pending_install ≈ registration "pending" (agent submitted proof).
 * installed ≈ registration "installed" (admin confirmed → KSh 200 commission).
 */

import { LEAD_INSTALL_COMMISSION_KES } from "@/lib/dispatch/constants";

export const LEAD_INSTALL_REVIEW_STATUSES = [
  "kyc_completed",
  "pending_install",
  "installed",
  "rejected",
  "duplicate",
  "cancelled",
] as const;

export type LeadInstallReviewStatus =
  (typeof LEAD_INSTALL_REVIEW_STATUSES)[number];

export const LEAD_INSTALL_CLOSED_STATUSES: LeadInstallReviewStatus[] = [
  "rejected",
  "duplicate",
  "cancelled",
];

export const LEAD_INSTALL_STATUS_STYLES: Record<string, string> = {
  kyc_completed: "bg-sky-100 text-sky-800 border-sky-200",
  pending_install: "bg-amber-100 text-amber-800 border-amber-200",
  installed: "bg-emerald-100 text-emerald-800 border-emerald-200",
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

export function leadInstallCommissionLabel(status: string): string {
  if (status === "installed") {
    return `KSh ${LEAD_INSTALL_COMMISSION_KES}`;
  }
  if (status === "pending_install") {
    return "Awaiting confirm";
  }
  if (status === "kyc_completed") {
    return "Awaiting install";
  }
  return "—";
}
