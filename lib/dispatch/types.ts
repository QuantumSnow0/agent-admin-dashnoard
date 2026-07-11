/**
 * Shared TypeScript types for lead dispatch (v1).
 * Edge functions mirror these shapes in _shared/dispatch/types.ts.
 */

import type {
  KYC_OUTCOMES,
  LEAD_PRODUCTS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  OFFER_STATUSES,
} from "./constants";

export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadProduct = (typeof LEAD_PRODUCTS)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export type KycOutcome = (typeof KYC_OUTCOMES)[number];

/** Payload websites send to create-inbound-lead. */
export type CreateInboundLeadPayload = {
  source: LeadSource;
  sourceExternalId?: string | null;
  product: LeadProduct;
  customerName: string;
  primaryPhone: string;
  alternatePhone?: string | null;
  email?: string | null;
  installationTown: string;
  installationArea?: string | null;
  deliveryLandmark?: string | null;
  county?: string | null;
  preferredPackage?: string | null;
  planLabel?: string | null;
  planGroup?: string | null;
  visitDate?: string | null;
  visitTime?: string | null;
  nationalId?: string | null;
  dateOfBirth?: string | null;
  /** Escape hatch for forward-compatible website fields. */
  metadata?: Record<string, unknown>;
};

/** Safe preview shown before an agent accepts (no PII). */
export type LeadOfferPreview = {
  product: LeadProduct;
  county: string | null;
  installationTown: string | null;
  roughArea: string | null;
  packageLabel: string | null;
  submittedAgoMinutes: number;
  distanceKm: number | null;
};

export type LeadOfferAction = "accept" | "decline";

export type LeadOutcomeAction =
  | "kyc_started"
  | "kyc_completed"
  | "unreachable"
  | "declined"
  | "kyc_failed"
  | "installed"
  | "release";
