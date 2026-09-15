import ExcelJS from "exceljs";
import JSZip from "jszip";
import { DOC_LIMITS } from "./document-limits.js";
import {
  inspectHeaders,
  parseInstalledFlag,
  resolveColumnMapping,
  type ColumnMapping,
  type MappingResolution,
} from "./document-mapping.js";
import type { ParsedCustomerRow, SheetParseResult } from "./document-parse-csv.js";

export type WorkbookInspectResult = {
  format: "xlsx";
  sheetNames: string[];
  sheets: Array<{
    sheetIndex: number;
    sheetName: string;
    headers: string[];
    mappingResolution: MappingResolution;
    approximateDataRows: number;
  }>;
  selection_required?: boolean;
  selection_kind?: "sheet";
  options?: Array<{ id: string; label: string; sheetIndex: number; sheetName: string }>;
  ask_user_hint?: string;
  security: {
    macrosRejected: boolean;
    externalLinksRejected: boolean;
    formulaCellsNeutralized: number;
  };
};

function assertZipSafe(buffer: Buffer): { macros: boolean; externalLinks: boolean } {
  // PK signature
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw Object.assign(new Error("Not a ZIP/XLSX archive"), { category: "malformed" });
  }
  return { macros: false, externalLinks: false }; // filled after async load
}

async function scanZipSecurity(buffer: Buffer): Promise<{
  macros: boolean;
  externalLinks: boolean;
}> {
  let macros = false;
  let externalLinks = false;
  let uncompressedTotal = 0;
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const names = Object.keys(zip.files);
  if (names.length > DOC_LIMITS.maxZipEntries) {
    throw Object.assign(new Error("Too many ZIP entries"), { category: "zip_bomb" });
  }
  for (const name of names) {
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\")) {
      throw Object.assign(new Error("ZIP path traversal"), { category: "zip_bomb" });
    }
    const entry = zip.files[name]!;
    if (entry.dir) continue;
    const lower = name.toLowerCase();
    if (lower.includes("vbaproject.bin") || lower.endsWith(".bin") && lower.includes("vba")) {
      macros = true;
    }
    if (lower.includes("externallinks") || lower.includes("externalLink".toLowerCase())) {
      externalLinks = true;
    }
    // Bound decompressed size by reading into memory with cap
    const data = await entry.async("uint8array");
    uncompressedTotal += data.byteLength;
    if (uncompressedTotal > DOC_LIMITS.maxDecompressedBytes) {
      throw Object.assign(new Error("Decompressed size exceeds limit"), { category: "zip_bomb" });
    }
  }
  return { macros, externalLinks };
}

function cellToString(cell: ExcelJS.Cell): { text: string; isFormula: boolean } {
  const anyCell = cell as ExcelJS.Cell & { formula?: string; sharedFormula?: string };
  if (anyCell.formula || anyCell.sharedFormula) {
    // Never evaluate — use cached result text if present, else empty
    const v = cell.value;
    if (v && typeof v === "object" && "result" in (v as object)) {
      const r = (v as { result?: unknown }).result;
      return { text: String(r ?? "").slice(0, DOC_LIMITS.maxCellChars), isFormula: true };
    }
    return { text: "", isFormula: true };
  }
  const v = cell.value;
  if (v == null) return { text: "", isFormula: false };
  if (typeof v === "object" && v && "text" in v) {
    return { text: String((v as { text: string }).text ?? "").slice(0, DOC_LIMITS.maxCellChars), isFormula: false };
  }
  if (typeof v === "object" && v && "richText" in v) {
    const rt = (v as { richText: Array<{ text: string }> }).richText;
    return {
      text: rt.map((x) => x.text).join("").slice(0, DOC_LIMITS.maxCellChars),
      isFormula: false,
    };
  }
  return { text: String(v).slice(0, DOC_LIMITS.maxCellChars), isFormula: false };
}

export async function inspectXlsxDocument(buffer: Buffer): Promise<WorkbookInspectResult> {
  assertZipSafe(buffer);
  const sec = await scanZipSecurity(buffer);
  if (sec.macros) {
    throw Object.assign(new Error("XLSX macros (vbaProject) are not allowed"), {
      category: "macros_rejected",
    });
  }
  if (sec.externalLinks) {
    throw Object.assign(new Error("XLSX external links are not allowed"), {
      category: "external_links_rejected",
    });
  }

  const wb = new ExcelJS.Workbook();
  // exceljs types: load accepts Buffer
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheetNames = wb.worksheets.map((w) => w.name);
  if (sheetNames.length === 0) {
    throw Object.assign(new Error("Workbook has no sheets"), { category: "empty" });
  }
  if (sheetNames.length > DOC_LIMITS.maxSheets) {
    throw Object.assign(new Error("Too many sheets"), { category: "limits" });
  }

  let formulaCellsNeutralized = 0;
  const sheets: WorkbookInspectResult["sheets"] = [];
  for (let si = 0; si < wb.worksheets.length; si++) {
    const ws = wb.worksheets[si]!;
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    const colCount = Math.min(ws.columnCount || DOC_LIMITS.maxColumns, DOC_LIMITS.maxColumns);
    for (let c = 1; c <= colCount; c++) {
      const { text, isFormula } = cellToString(headerRow.getCell(c));
      if (isFormula) formulaCellsNeutralized++;
      headers.push(text);
      if (headers.length >= DOC_LIMITS.maxColumns) break;
    }
    // trim trailing empties
    while (headers.length && !headers[headers.length - 1]!.trim()) headers.pop();
    const mappingResolution = resolveColumnMapping(inspectHeaders(headers));
    const approximateDataRows = Math.max(0, (ws.rowCount || 1) - 1);
    sheets.push({
      sheetIndex: si,
      sheetName: ws.name,
      headers,
      mappingResolution,
      approximateDataRows,
    });
  }

  const result: WorkbookInspectResult = {
    format: "xlsx",
    sheetNames,
    sheets,
    security: {
      macrosRejected: false,
      externalLinksRejected: false,
      formulaCellsNeutralized,
    },
  };

  if (sheetNames.length > 1) {
    result.selection_required = true;
    result.selection_kind = "sheet";
    result.options = sheetNames.map((sheetName, sheetIndex) => ({
      id: `sheet-${sheetIndex}`,
      label: sheetName,
      sheetIndex,
      sheetName,
    }));
    result.ask_user_hint =
      "Multiple sheets found. Use OpenClaw ask_user / inline single-select — not a Telegram poll.";
  }
  return result;
}

export async function parseXlsxSheet(
  buffer: Buffer,
  opts: {
    sheetIndex?: number;
    sheetName?: string;
    mapping?: ColumnMapping;
    installedOnly?: boolean;
    maxRows?: number;
  } = {},
): Promise<SheetParseResult> {
  const started = Date.now();
  const inspect = await inspectXlsxDocument(buffer);
  let sheetIndex = opts.sheetIndex ?? 0;
  if (opts.sheetName) {
    const idx = inspect.sheetNames.indexOf(opts.sheetName);
    if (idx < 0) {
      throw Object.assign(new Error("Sheet not found"), { category: "validation" });
    }
    sheetIndex = idx;
  }
  if (inspect.sheetNames.length > 1 && opts.sheetIndex == null && opts.sheetName == null) {
    return {
      sheetName: inspect.sheetNames[0]!,
      sheetIndex: 0,
      headers: inspect.sheets[0]?.headers ?? [],
      mappingResolution: {
        status: "ambiguous",
        message: "Multiple sheets; select one before parse.",
        selection_required: true,
        selection_kind: "column_mapping",
        options: inspect.options!.map((o) => ({
          id: o.id,
          label: o.label,
          mapping: {},
        })),
        ask_user_hint: inspect.ask_user_hint!,
      },
      rows: [],
      qualifyingRowCount: 0,
      truncated: false,
    };
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[sheetIndex];
  if (!ws) throw Object.assign(new Error("Sheet missing"), { category: "validation" });

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  const colCount = Math.min(ws.columnCount || DOC_LIMITS.maxColumns, DOC_LIMITS.maxColumns);
  let formulaCells = 0;
  for (let c = 1; c <= colCount; c++) {
    const { text, isFormula } = cellToString(headerRow.getCell(c));
    if (isFormula) formulaCells++;
    headers.push(text);
  }
  while (headers.length && !headers[headers.length - 1]!.trim()) headers.pop();

  const mappingResolution = opts.mapping
    ? ({ status: "resolved" as const, mapping: opts.mapping, confidence: "high" as const })
    : resolveColumnMapping(inspectHeaders(headers));

  if (mappingResolution.status !== "resolved") {
    return {
      sheetName: ws.name,
      sheetIndex,
      headers,
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
  const lastRow = Math.min(ws.rowCount || 1, maxRows + 1);
  for (let r = 2; r <= (ws.rowCount || 1); r++) {
    if (Date.now() - started > DOC_LIMITS.maxParseMs) {
      throw Object.assign(new Error("Parse timeout"), { category: "timeout" });
    }
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    if (r > lastRow && rows.length >= maxRows) break;
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= headers.length; c++) {
      const { text, isFormula } = cellToString(row.getCell(c));
      if (isFormula) formulaCells++;
      cells.push(text);
    }
    if (cells.every((c) => !c.trim())) continue;
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
    const installed = parseInstalledFlag(
      mapping.spreadsheet_installed != null ? cells[mapping.spreadsheet_installed] : undefined,
    );
    if (opts.installedOnly && installed !== true) continue;
    if (!airtel && !saf) continue;
    rows.push({
      row_ref: `R${r}`,
      source_row_number: r,
      customer_name: name,
      airtel_phone: airtel,
      safaricom_phone: saf,
      spreadsheet_installed: installed === null ? undefined : installed,
    });
  }

  void formulaCells;
  return {
    sheetName: ws.name,
    sheetIndex,
    headers,
    mappingResolution,
    rows,
    qualifyingRowCount: rows.length,
    truncated,
  };
}

export { scanZipSecurity };
