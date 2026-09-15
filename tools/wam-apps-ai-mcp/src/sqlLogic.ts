/**
 * Pure TypeScript mirrors of Phase 1A SQL reporting rules for unit tests.
 * Keep behaviour aligned with wam_ai.* helpers in the reporting migration.
 */

export type OfferRow = {
  status: string;
  createdAt: Date | string;
  expiresAt: Date | string | null;
};

function toMs(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** MAX of timestamps ignoring nulls (mirrors GREATEST / assigned_progress_at). */
export function assignedProgressAt(
  callInitiatedAt: Date | string | null | undefined,
  kycStartedAt: Date | string | null | undefined,
  acceptedAt: Date | string | null | undefined,
  updatedAt: Date | string | null | undefined,
  createdAt: Date | string | null | undefined,
): Date | null {
  const vals = [callInitiatedAt, kycStartedAt, acceptedAt, updatedAt, createdAt]
    .map(toMs)
    .filter((n): n is number => n != null);
  if (!vals.length) return null;
  return new Date(Math.max(...vals));
}

/**
 * True when any offered row is still valid:
 * - expires_at > now, OR
 * - expires_at IS NULL AND created_at >= now - timeoutMinutes
 */
export function hasValidActiveOffer(
  now: Date,
  offers: OfferRow[],
  timeoutMinutes: number,
): boolean {
  const nowMs = now.getTime();
  const timeoutMs = timeoutMinutes * 60_000;
  return offers.some((o) => {
    if (o.status !== "offered") return false;
    const expires = toMs(o.expiresAt);
    if (expires != null) return expires > nowMs;
    const created = toMs(o.createdAt);
    if (created == null) return false;
    return created >= nowMs - timeoutMs;
  });
}

/**
 * STUCK_OFFER when lead status is offered and no still-valid active offer exists.
 * Cases covered by callers/tests:
 * - missing offer row → stuck
 * - latest offer expired → stuck
 * - valid offer after expired historical → not stuck
 */
export function stallCodeStuckOffer(
  now: Date,
  leadStatus: string,
  offers: OfferRow[],
  timeoutMinutes: number,
): "STUCK_OFFER" | null {
  if (leadStatus !== "offered") return null;
  if (hasValidActiveOffer(now, offers, timeoutMinutes)) return null;
  return "STUCK_OFFER";
}

export type ClippedBucket = {
  windowFrom: Date;
  windowTo: Date;
};

/**
 * Clip a bucket to [rangeFrom, rangeTo] (mirrors GREATEST/LEAST trend windows).
 * Returns null when the clipped window is empty.
 */
export function clipBucketWindow(
  bucketStart: Date,
  stepMs: number,
  rangeFrom: Date,
  rangeTo: Date,
): ClippedBucket | null {
  // Match SQL: LEAST(bucket + step - 1 microsecond, range_to)
  const bucketEnd = new Date(bucketStart.getTime() + stepMs - 0.001);
  const windowFrom = new Date(Math.max(bucketStart.getTime(), rangeFrom.getTime()));
  const windowTo = new Date(Math.min(bucketEnd.getTime(), rangeTo.getTime()));
  if (windowFrom.getTime() > windowTo.getTime()) return null;
  return { windowFrom, windowTo };
}

export type ProductFilter = "airtel" | "safaricom" | null | undefined;

/**
 * Labelling helpers for get_operational_summary product-filter consistency.
 */
export function productSummaryFields(product: ProductFilter): {
  productFilter: "airtel" | "safaricom" | null;
  includeAirtelRegistrations: boolean;
  includeSafaricomRegistrations: boolean;
  productFilteredFields: string[];
  platformWideFields: string[];
} {
  const productFilter = product === "airtel" || product === "safaricom" ? product : null;
  return {
    productFilter,
    includeAirtelRegistrations: productFilter === null || productFilter === "airtel",
    includeSafaricomRegistrations: productFilter === null || productFilter === "safaricom",
    productFilteredFields: [
      "inbound_leads_created",
      "inbound_status_counts",
      "lead_offers_created",
      "inbound_installed_in_range",
      "registration_installed_in_range_for_filter",
      "airtel_customer_registrations_*",
      "safaricom_registrations_*",
    ],
    platformWideFields: ["platform_wide.*"],
  };
}

/**
 * Exact stall totals vs display list: totals must ignore display limit.
 */
export function exactStallTotals(
  stallCodes: string[],
  displayLimit: number,
): { total: number; displayed: string[]; countsByCode: Record<string, number> } {
  const countsByCode: Record<string, number> = {};
  for (const code of stallCodes) {
    countsByCode[code] = (countsByCode[code] ?? 0) + 1;
  }
  return {
    total: stallCodes.length,
    displayed: stallCodes.slice(0, displayLimit),
    countsByCode,
  };
}
