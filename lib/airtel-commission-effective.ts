/** Upper bound for admin commission_units override (DB constraint). */
export const MAX_ADMIN_COMMISSION_UNITS = 20;

export type AirtelCommissionBasisRow = {
  preferred_package?: string | null;
  units_required?: number | null;
  commission_package?: string | null;
  commission_units?: number | null;
};

/** Commission units from stored registration/override values (no cap on units_required). */
export function normalizeCommissionUnits(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/** Max units an admin may set when overriding commission for a registration. */
export function getMaxCommissionOverrideUnits(
  registeredUnits?: number | null
): number {
  const registered = normalizeCommissionUnits(registeredUnits ?? 1);
  return Math.min(MAX_ADMIN_COMMISSION_UNITS, Math.max(registered, 2));
}

export function clampCommissionOverrideUnits(
  value: unknown,
  registeredUnits?: number | null
): number {
  const max = getMaxCommissionOverrideUnits(registeredUnits);
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(max, Math.max(1, n));
}

/** Package used for commission (admin override or agent registration). */
export function getEffectiveCommissionPackage(
  row: AirtelCommissionBasisRow
): "standard" | "premium" {
  const pkg = (row.commission_package ?? row.preferred_package ?? "standard")
    .toString()
    .trim()
    .toLowerCase();
  return pkg === "premium" ? "premium" : "standard";
}

/** Units used for commission (admin override or agent registration). */
export function getEffectiveCommissionUnits(row: AirtelCommissionBasisRow): number {
  const raw =
    row.commission_units != null ? row.commission_units : row.units_required;
  return normalizeCommissionUnits(raw);
}

export function hasCommissionOverride(row: AirtelCommissionBasisRow): boolean {
  return row.commission_package != null || row.commission_units != null;
}
