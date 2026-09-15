import { DOC_LIMITS } from "./document-limits.js";

export type ColumnRole =
  | "customer_name"
  | "airtel_phone"
  | "safaricom_phone"
  | "spreadsheet_installed"
  | "ignore";

export type HeaderCandidate = {
  columnIndex: number;
  header: string;
  normalized: string;
  suggestedRoles: ColumnRole[];
};

export type ColumnMapping = {
  customer_name?: number;
  airtel_phone?: number;
  safaricom_phone?: number;
  spreadsheet_installed?: number;
};

export type MappingResolution =
  | { status: "resolved"; mapping: ColumnMapping; confidence: "high" | "medium" }
  | {
      status: "ambiguous";
      message: string;
      selection_required: true;
      selection_kind: "column_mapping" | "sheet";
      options: Array<{ id: string; label: string; mapping: ColumnMapping; sheetIndex?: number }>;
      ask_user_hint: string;
    }
  | { status: "unresolved"; message: string };

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[\s_\-/\\]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const ROLE_PATTERNS: Array<{ role: ColumnRole; patterns: RegExp[] }> = [
  {
    role: "airtel_phone",
    patterns: [
      /^airtel/,
      /airtel(msisdn|number|phone|no|num)/,
      /^(msisdn|mobile|phone|phonenumber|primaryphone|contact)$/,
    ],
  },
  {
    role: "safaricom_phone",
    patterns: [
      /^safaricom/,
      /safaricom(msisdn|number|phone|no|num)/,
      /^(alternate|altphone|secondaryphone|otherphone)$/,
    ],
  },
  {
    role: "customer_name",
    patterns: [/^(customer)?name$/, /clientname/, /fullnamename/, /^fullname$/],
  },
  {
    role: "spreadsheet_installed",
    patterns: [/install/, /status/, /installed/, /outcome/],
  },
];

export function classifyHeader(raw: string): ColumnRole[] {
  const n = normalizeHeader(raw);
  if (!n) return [];
  const roles: ColumnRole[] = [];
  for (const { role, patterns } of ROLE_PATTERNS) {
    if (patterns.some((p) => p.test(n))) roles.push(role);
  }
  return roles;
}

export function inspectHeaders(headers: string[]): HeaderCandidate[] {
  return headers.slice(0, DOC_LIMITS.maxColumns).map((header, columnIndex) => ({
    columnIndex,
    header: String(header ?? "").slice(0, 120),
    normalized: normalizeHeader(String(header ?? "")),
    suggestedRoles: classifyHeader(String(header ?? "")),
  }));
}

function scoreMapping(candidates: HeaderCandidate[], mapping: ColumnMapping): number {
  let s = 0;
  if (mapping.airtel_phone != null) s += 3;
  if (mapping.safaricom_phone != null) s += 2;
  if (mapping.customer_name != null) s += 1;
  if (mapping.spreadsheet_installed != null) s += 1;
  // prefer headers that suggested the role
  for (const [role, idx] of Object.entries(mapping) as [keyof ColumnMapping, number][]) {
    const c = candidates.find((x) => x.columnIndex === idx);
    if (c?.suggestedRoles.includes(role as ColumnRole)) s += 2;
  }
  return s;
}

/** Auto-map when unique; otherwise return ask_user options. Never guess ties. */
export function resolveColumnMapping(candidates: HeaderCandidate[]): MappingResolution {
  const byRole = new Map<ColumnRole, number[]>();
  for (const c of candidates) {
    for (const role of c.suggestedRoles) {
      if (role === "ignore") continue;
      const list = byRole.get(role) ?? [];
      list.push(c.columnIndex);
      byRole.set(role, list);
    }
  }

  for (const role of ["airtel_phone", "safaricom_phone"] as ColumnRole[]) {
    const hits = byRole.get(role) ?? [];
    if (hits.length > 1) {
      const options = hits.map((col, i) => {
        const mapping: ColumnMapping = {};
        if (role === "airtel_phone") mapping.airtel_phone = col;
        else mapping.safaricom_phone = col;
        // fill unique other roles
        for (const r of ["customer_name", "airtel_phone", "safaricom_phone", "spreadsheet_installed"] as ColumnRole[]) {
          if (r === role) continue;
          const hs = byRole.get(r) ?? [];
          if (hs.length === 1) {
            (mapping as Record<string, number>)[r] = hs[0]!;
          }
        }
        const label = `${role} → column ${col} (${candidates.find((c) => c.columnIndex === col)?.header ?? col})`;
        return { id: `map-${role}-${i}`, label, mapping };
      });
      return {
        status: "ambiguous",
        message: `Multiple columns match ${role}; choose one mapping.`,
        selection_required: true,
        selection_kind: "column_mapping",
        options,
        ask_user_hint: "Use OpenClaw ask_user / inline single-select — not a Telegram poll.",
      };
    }
  }

  const mapping: ColumnMapping = {};
  for (const role of ["customer_name", "airtel_phone", "safaricom_phone", "spreadsheet_installed"] as ColumnRole[]) {
    const hs = byRole.get(role) ?? [];
    if (hs.length === 1) (mapping as Record<string, number>)[role] = hs[0]!;
  }

  if (mapping.airtel_phone == null && mapping.safaricom_phone == null) {
    // Try generic phone columns: if exactly one phone-like column, treat as airtel
    const phoneCols = candidates.filter((c) =>
      c.suggestedRoles.includes("airtel_phone") || /phone|msisdn|mobile/.test(c.normalized),
    );
    if (phoneCols.length === 1) {
      mapping.airtel_phone = phoneCols[0]!.columnIndex;
    } else if (phoneCols.length > 1) {
      return {
        status: "ambiguous",
        message: "Multiple phone-like columns; choose mapping.",
        selection_required: true,
        selection_kind: "column_mapping",
        options: phoneCols.map((c, i) => ({
          id: `phone-${i}`,
          label: `Use column ${c.columnIndex} (${c.header}) as Airtel/primary phone`,
          mapping: { airtel_phone: c.columnIndex },
        })),
        ask_user_hint: "Use OpenClaw ask_user / inline single-select — not a Telegram poll.",
      };
    } else {
      return {
        status: "unresolved",
        message: "No phone columns detected. Provide an explicit column mapping.",
      };
    }
  }

  const conf = scoreMapping(candidates, mapping) >= 5 ? "high" : "medium";
  return { status: "resolved", mapping, confidence: conf };
}

export function parseInstalledFlag(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (["true", "yes", "1", "installed", "y"].includes(s)) return true;
  if (["false", "no", "0", "not_installed", "n", "pending"].includes(s)) return false;
  if (s.includes("install") && !s.includes("not")) return true;
  return null;
}

/** Neutralize CSV formula-injection prefixes for display/export safety. */
export function neutralizeCsvCell(raw: string): string {
  const t = raw.trim();
  if (/^[=+\-@]/.test(t)) return `'${t}`;
  return t;
}
