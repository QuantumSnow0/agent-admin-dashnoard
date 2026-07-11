/**
 * Lead dispatch constants (v1).
 * Keep in sync with SQL CHECK constraints in 20260711140000_lead_dispatch_v1.sql.
 * When adding values, update both SQL migration (new file) and this file.
 */

export const DISPATCH_DEFAULTS = {
  offerTimeoutMinutes: 15,
  slaHours: 24,
  maxOpenLeadsPerAgent: 3,
} as const;

export const LEAD_SOURCES = [
  "airtel5grouter",
  "internetkenya",
  "agent_own",
] as const;

export const LEAD_PRODUCTS = ["airtel", "safaricom"] as const;

export const LEAD_STATUSES = [
  "pending_dispatch",
  "offered",
  "assigned",
  "kyc_in_progress",
  "kyc_completed",
  "installed",
  "needs_reassignment",
  "admin_queue",
  "lost",
  "expired",
] as const;

export const LEAD_DISPATCH_SCOPES = [
  "both",
  "airtel",
  "safaricom",
  "none",
] as const;

export const OFFER_STATUSES = [
  "offered",
  "accepted",
  "declined",
  "expired",
  "superseded",
] as const;

export const KYC_OUTCOMES = [
  "completed",
  "unreachable",
  "declined",
  "kyc_failed",
] as const;

export const NOTIFICATION_TYPES = {
  LEAD_OFFER: "LEAD_OFFER",
  LEAD_OVERDUE: "LEAD_OVERDUE",
} as const;

/** Android package for Airtel Connect KYC (v1: launch or Play Store fallback). */
export const AIRTEL_CONNECT_PACKAGE = "com.airtel.airtelwork.africa";
