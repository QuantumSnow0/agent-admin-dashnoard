/**
 * Dispatch constants for edge functions (mirror of lib/dispatch/constants.ts).
 * v1 — extend via new migrations + update both files.
 */

export const DISPATCH_DEFAULTS = {
  offerTimeoutMinutes: 15,
  slaHours: 24,
  maxOpenLeadsPerAgent: 3,
} as const;

export const ACTIVE_LEAD_STATUSES = [
  "offered",
  "assigned",
  "kyc_in_progress",
  "kyc_completed",
] as const;

export const TERMINAL_LEAD_STATUSES = [
  "installed",
  "lost",
  "expired",
] as const;

export const NOTIFICATION_TYPE_LEAD_OFFER = "LEAD_OFFER";
