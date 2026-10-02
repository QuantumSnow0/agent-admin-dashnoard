/** Customer registration pipeline statuses (not agent account status). */
export const REGISTRATION_STATUSES = [
  "pending",
  "installed",
  "approved",
  "denied",
  "rejected",
  "duplicate",
  "cancelled",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Terminal outcomes — registration will not be installed. */
export const REGISTRATION_CLOSED_STATUSES: RegistrationStatus[] = [
  "denied",
  "rejected",
  "duplicate",
  "cancelled",
];

export const REGISTRATION_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  installed: "bg-sky-100 text-sky-800 border-sky-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  denied: "bg-red-100 text-red-800 border-red-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  duplicate: "bg-violet-100 text-violet-800 border-violet-200",
  cancelled: "bg-gray-100 text-gray-800 border-gray-200",
};

export function isClosedRegistrationStatus(status: string): boolean {
  return (REGISTRATION_CLOSED_STATUSES as readonly string[]).includes(status);
}

export function formatRegistrationStatusLabel(status: string): string {
  switch (status) {
    case "pending":
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
      return status;
  }
}
