/**
 * v1 geography helpers — town centroids from location_reference.
 */

export type GeoPoint = { latitude: number; longitude: number };

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function normalizeTownKey(town: string | null | undefined): string {
  return (town ?? "")
    .trim()
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeCountyKey(county: string | null | undefined): string {
  return (county ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}
