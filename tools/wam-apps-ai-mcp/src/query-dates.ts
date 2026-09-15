/**
 * Africa/Nairobi relative date ranges as half-open [start, end) ISO timestamptz strings.
 * Pure TS — SQL RPCs recompute the same boundaries server-side for enforcement.
 */

import { BUSINESS_TZ } from "./query-catalogue.js";

export type RelativePeriod =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month";

const RELATIVE_PERIODS: readonly RelativePeriod[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
];

export function isRelativePeriod(v: unknown): v is RelativePeriod {
  return typeof v === "string" && (RELATIVE_PERIODS as readonly string[]).includes(v);
}

/** Format a Date as YYYY-MM-DD in Africa/Nairobi. */
export function nairobiYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Parse YYYY-MM-DD as start-of-day Africa/Nairobi → UTC Date. */
export function nairobiStartUtc(ymd: string): Date {
  // Nairobi is UTC+3 year-round (no DST)
  return new Date(`${ymd}T00:00:00+03:00`);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = nairobiStartUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return nairobiYmd(d);
}

function startOfWeekMonday(ymd: string): string {
  const d = nairobiStartUtc(ymd);
  // getDay in UTC of the Nairobi midnight instant: Monday=1 ... Sunday=0
  const dow = new Date(`${ymd}T12:00:00+03:00`).getUTCDay(); // 0 Sun .. 6 Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addDaysYmd(ymd, mondayOffset);
}

function startOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function nextMonthStart(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/**
 * Half-open [start, end) as ISO timestamptz strings (UTC).
 * Calendar comparisons for DATE / date_text_mdy use the Nairobi calendar dates of start/end.
 */
export function relativeRange(
  period: RelativePeriod,
  now: Date = new Date(),
): { start: string; end: string; start_date: string; end_date: string } {
  const today = nairobiYmd(now);
  let startDate: string;
  let endDate: string;

  switch (period) {
    case "today":
      startDate = today;
      endDate = addDaysYmd(today, 1);
      break;
    case "yesterday":
      startDate = addDaysYmd(today, -1);
      endDate = today;
      break;
    case "this_week":
      startDate = startOfWeekMonday(today);
      endDate = addDaysYmd(startDate, 7);
      break;
    case "last_week": {
      const thisMon = startOfWeekMonday(today);
      startDate = addDaysYmd(thisMon, -7);
      endDate = thisMon;
      break;
    }
    case "this_month":
      startDate = startOfMonth(today);
      endDate = nextMonthStart(today);
      break;
    case "last_month": {
      const thisMonStart = startOfMonth(today);
      const prev = addDaysYmd(thisMonStart, -1);
      startDate = startOfMonth(prev);
      endDate = thisMonStart;
      break;
    }
    default: {
      const _exhaustive: never = period;
      throw new Error(`Unknown period: ${_exhaustive}`);
    }
  }

  return {
    start: nairobiStartUtc(startDate).toISOString(),
    end: nairobiStartUtc(endDate).toISOString(),
    start_date: startDate,
    end_date: endDate,
  };
}

/**
 * Fail-closed dual-format parser for customer_registrations.visit_date TEXT.
 * Accepts:
 *   - M/d/yyyy (1–2 digit month/day, 4-digit year)
 *   - ISO YYYY-MM-DD (exact 4-2-2 digit widths)
 * Leading/trailing whitespace is trimmed; internal whitespace is rejected.
 * Impossible calendar dates and malformed strings return null (no silent normalization).
 */
export function parseVisitDateText(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  let month: number;
  let day: number;
  let year: number;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (mdy) {
    month = Number(mdy[1]);
    day = Number(mdy[2]);
    year = Number(mdy[3]);
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** @deprecated Use parseVisitDateText — retained alias for existing unit imports. */
export function parseMdyVisitDate(raw: string): string | null {
  return parseVisitDateText(raw);
}
