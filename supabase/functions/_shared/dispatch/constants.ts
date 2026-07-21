/**
 * Dispatch constants for edge functions (mirror of lib/dispatch/constants.ts).
 * v1 — extend via new migrations + update both files.
 */

export const DISPATCH_DEFAULTS = {
  offerTimeoutMinutes: 15,
  slaHours: 24,
  maxOpenLeadsPerAgent: 3,
  /** When false, auto-dispatch ignores max_open_leads_per_agent. */
  maxOpenLeadsEnabled: true,
  onlinePresenceMinutes: 5,
} as const;

export const ACTIVE_LEAD_STATUSES = [
  "offered",
  "assigned",
  "kyc_in_progress",
  "kyc_completed",
] as const;

export const TERMINAL_LEAD_STATUSES = [
  "pending_install",
  "installed",
  "lost",
  "expired",
] as const;

export const NOTIFICATION_TYPE_LEAD_OFFER = "LEAD_OFFER";

/** Flat commission when an inbound lead is marked installed (agent SR/IMEI proof). */
export const LEAD_INSTALL_COMMISSION_KES = 200;
