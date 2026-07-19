/**
 * Material Design 3 push / OS notification copy for blind lead offers.
 */

export const LEAD_OFFER_CATEGORY_ID = "LEAD_OFFER";
export const LEAD_OFFER_ANDROID_TAG_PREFIX = "wam_lead_";
export const LEAD_OFFER_RESPONSE_SECONDS = 30;

export type LeadOfferPreview = {
  product?: string;
  installationTown?: string | null;
  roughArea?: string | null;
  packageLabel?: string | null;
  distanceKm?: number | null;
};

export type LeadOfferNotificationCopy = {
  title: string;
  subtitle: string;
  message: string;
  accentColor: string;
  product: string;
  leadCount: number;
};

export function capitalizeBrand(product: string): string {
  if (product === "safaricom") return "Safaricom";
  if (product === "airtel") return "Airtel";
  return product.charAt(0).toUpperCase() + product.slice(1);
}

export function formatLeadLocation(preview: LeadOfferPreview): string {
  const town = String(preview.installationTown ?? "").trim();
  const area = preview.roughArea ? String(preview.roughArea).trim() : "";
  if (area && town) return `${area}, ${town}`;
  return area || town || "Nearby";
}

export function humanizePackageLabel(
  packageLabel: string | null | undefined,
): string {
  if (!packageLabel?.trim()) return "Internet package";

  let s = packageLabel
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s+at\s+ksh\.?\s*[\d,]+.*/i, "")
    .replace(/\s+at\s+.*/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const airtelStyle = s.match(
    /^(5G|4G|LTE)?\s*(\d+)\s*Mbps\s*(\d+\s*days?)?/i,
  );
  if (airtelStyle) {
    const tech = airtelStyle[1]?.toUpperCase();
    const speed = `${airtelStyle[2]} Mbps`;
    return tech ? `${tech} · ${speed}` : speed;
  }

  const speedOnly = s.match(/(\d+)\s*Mbps/i);
  if (speedOnly) {
    const prefix = s
      .replace(/\d+\s*Mbps/i, "")
      .replace(/\d+\s*days?/i, "")
      .trim();
    const speed = `${speedOnly[1]} Mbps`;
    if (/fibre|fiber|home|internet|5g|4g/i.test(prefix)) {
      const cleaned = prefix
        .replace(/\s+/g, " ")
        .replace(/\b(\d+\s*days?)\b/i, "")
        .trim();
      return cleaned ? `${cleaned} · ${speed}` : speed;
    }
    return speed;
  }

  return s.length > 48 ? `${s.slice(0, 45).trim()}…` : s;
}

export function providerAccentColor(product: string): string {
  if (product === "safaricom") return "#59B848";
  if (product === "airtel") return "#E60000";
  return "#E53935";
}

export function formatSingleLeadOfferCopy(
  preview: LeadOfferPreview,
): LeadOfferNotificationCopy {
  const product = String(preview.product ?? "lead");
  const brand = capitalizeBrand(product);
  const location = formatLeadLocation(preview);
  const pkg = humanizePackageLabel(preview.packageLabel);

  return {
    title: location,
    subtitle: `${brand} · New lead`,
    message: pkg,
    accentColor: providerAccentColor(product),
    product,
    leadCount: 1,
  };
}

export function formatLeadOfferNotificationCopy(
  preview: Record<string, unknown>,
): { title: string; message: string } {
  const copy = formatSingleLeadOfferCopy(preview as LeadOfferPreview);
  return {
    title: copy.title,
    message: `${copy.subtitle} · ${copy.message}`,
  };
}

export function leadOfferNotificationTag(offerId: string): string {
  return `${LEAD_OFFER_ANDROID_TAG_PREFIX}${offerId}`;
}
