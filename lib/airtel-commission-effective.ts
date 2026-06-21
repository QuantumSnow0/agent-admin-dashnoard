export const MAX_COMMISSION_UNITS = 2;

export type AirtelCommissionBasisRow = {
  preferred_package?: string | null;
  units_required?: number | null;
  commission_package?: string | null;
  commission_units?: number | null;
};

export function normalizeCommissionUnits(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_COMMISSION_UNITS, Math.floor(n));
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
