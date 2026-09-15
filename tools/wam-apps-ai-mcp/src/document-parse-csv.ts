import { DOC_LIMITS } from "./document-limits.js";
import {
  inspectHeaders,
  neutralizeCsvCell,
  parseInstalledFlag,
  resolveColumnMapping,
  type ColumnMapping,
  type MappingResolution,
} from "./document-mapping.js";

export type ParsedCustomerRow = {
  row_ref: string;
  source_row_number: number;
  customer_name?: string;
  airtel_phone?: string;
  safaricom_phone?: string;
  spreadsheet_installed?: boolean | string;
};

export type SheetParseResult = {
  sheetName: string;
  sheetIndex: number;
  headers: string[];
  mappingResolution: MappingResolution;
  rows: ParsedCustomerRow[];
  qualifyingRowCount: number;
  truncated: boolean;
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsvDocument(
  buffer: Buffer,
  opts: {
    mapping?: ColumnMapping;
    installedOnly?: boolean;
    maxRows?: number;
  } = {},
): SheetParseResult {
  const started = Date.now();
  const text = buffer.toString("utf8");
  if (text.includes("\0")) {
    throw Object.assign(new Error("Binary content in CSV"), { category: "malformed" });
  }
  const lines = text.split(/\r?\n/).filter((l, idx, arr) => !(idx === arr.length - 1 && l === ""));
  if (lines.length === 0) {
    throw Object.assign(new Error("Empty CSV"), { category: "empty" });
  }
  const headerCells = splitCsvLine(lines[0]!).map((h) =>
    neutralizeCsvCell(h).slice(0, DOC_LIMITS.maxCellChars),
  );
  if (headerCells.length > DOC_LIMITS.maxColumns) {
    throw Object.assign(new Error("Too many columns"), { category: "limits" });
  }
  const candidates = inspectHeaders(headerCells);
  const mappingResolution = opts.mapping
    ? ({ status: "resolved", mapping: opts.mapping, confidence: "high" } as const)
    : resolveColumnMapping(candidates);
  if (mappingResolution.status !== "resolved") {
    return {
      sheetName: "csv",
      sheetIndex: 0,
      headers: headerCells,
      mappingResolution,
      rows: [],
      qualifyingRowCount: 0,
      truncated: false,
    };
  }
  const mapping = mappingResolution.mapping;
  const maxRows = opts.maxRows ?? DOC_LIMITS.maxRowsPerSheet;
  const rows: ParsedCustomerRow[] = [];
  let truncated = false;
  for (let i = 1; i < lines.length; i++) {
    if (Date.now() - started > DOC_LIMITS.maxParseMs) {
      throw Object.assign(new Error("Parse timeout"), { category: "timeout" });
    }
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const cells = splitCsvLine(lines[i]!).map((c) =>
      neutralizeCsvCell(c).slice(0, DOC_LIMITS.maxCellChars),
    );
    if (cells.every((c) => !c.trim())) continue;
    const source_row_number = i + 1;
    const airtel =
      mapping.airtel_phone != null ? cells[mapping.airtel_phone]?.trim() || undefined : undefined;
    const saf =
      mapping.safaricom_phone != null
        ? cells[mapping.safaricom_phone]?.trim() || undefined
        : undefined;
    const name =
      mapping.customer_name != null
        ? cells[mapping.customer_name]?.trim().slice(0, 120) || undefined
        : undefined;
    const installedRaw =
      mapping.spreadsheet_installed != null ? cells[mapping.spreadsheet_installed] : undefined;
    const installed = parseInstalledFlag(installedRaw);
    if (opts.installedOnly && installed !== true) continue;
    if (!airtel && !saf) continue;
    rows.push({
      row_ref: `R${source_row_number}`,
      source_row_number,
      customer_name: name,
      airtel_phone: airtel,
      safaricom_phone: saf,
      spreadsheet_installed: installed === null ? undefined : installed,
    });
  }
  return {
    sheetName: "csv",
    sheetIndex: 0,
    headers: headerCells,
    mappingResolution,
    rows,
    qualifyingRowCount: rows.length,
    truncated,
  };
}
