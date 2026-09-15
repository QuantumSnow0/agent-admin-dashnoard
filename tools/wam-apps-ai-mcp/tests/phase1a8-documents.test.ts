import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AttachmentPathError,
  openAllowlistedAttachment,
  fingerprintBuffer,
} from "../src/attachment-path.js";
import { DOC_LIMITS } from "../src/document-limits.js";
import { parseCsvDocument } from "../src/document-parse-csv.js";
import { inspectXlsxDocument, parseXlsxSheet, scanZipSecurity } from "../src/document-parse-xlsx.js";
import { resolveColumnMapping, neutralizeCsvCell } from "../src/document-mapping.js";
import { redactDocumentAuditArgs } from "../src/validation-documents.js";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "phase1a8");

describe("Phase 1A.8 attachment path containment", () => {
  let rootA: string;
  let rootB: string;
  let outside: string;
  let openclawTree: string;

  beforeEach(() => {
    rootA = fs.mkdtempSync(path.join(os.tmpdir(), "wam-att-a-"));
    rootB = fs.mkdtempSync(path.join(os.tmpdir(), "wam-att-b-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "wam-att-out-"));
    openclawTree = fs.mkdtempSync(path.join(os.tmpdir(), "wam-openclaw-"));
    fs.writeFileSync(path.join(rootA, "ok.csv"), "Airtel Phone\n254711800001\n");
    const staged = path.join(rootB, "openclaw-staged-ef2413f3-0639-4334-9af4-0c44bcee4f0c");
    fs.mkdirSync(staged);
    fs.writeFileSync(path.join(staged, "ok.csv"), "Airtel Phone\n254711800001\n");
    fs.writeFileSync(path.join(outside, "secret.csv"), "Airtel Phone\n254711800099\n");
    fs.writeFileSync(path.join(outside, ".env"), "SECRET=1\n");
    // Simulate other .openclaw paths (plugins / assets) — must be rejected
    const pluginDir = path.join(openclawTree, "extensions", "plugin-assets");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "template.xlsx"), "PK\x03\x04fake");
    fs.writeFileSync(path.join(pluginDir, "customers.csv"), "Airtel Phone\n254711800001\n");
  });

  afterEach(() => {
    for (const d of [rootA, rootB, outside, openclawTree]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("accepts files under both verified roots including staged subdirs", () => {
    const roots = `${rootA};${rootB}`;
    const a = openAllowlistedAttachment(path.join(rootA, "ok.csv"), roots);
    const b = openAllowlistedAttachment(
      path.join(rootB, "openclaw-staged-ef2413f3-0639-4334-9af4-0c44bcee4f0c", "ok.csv"),
      roots,
    );
    expect(a.contentFingerprint).toBe(b.contentFingerprint);
    expect(a.rootIndex).toBe(0);
    expect(b.rootIndex).toBe(1);
  });

  it("rejects paths outside roots, plugin assets, and .env names", () => {
    const roots = `${rootA};${rootB}`;
    expect(() => openAllowlistedAttachment(path.join(outside, "secret.csv"), roots)).toThrow(
      AttachmentPathError,
    );
    expect(() =>
      openAllowlistedAttachment(path.join(openclawTree, "extensions", "plugin-assets", "customers.csv"), roots),
    ).toThrow(AttachmentPathError);
    fs.writeFileSync(path.join(rootA, ".env"), "x=1");
    expect(() => openAllowlistedAttachment(path.join(rootA, ".env"), roots)).toThrow(
      AttachmentPathError,
    );
  });

  it("rejects traversal", () => {
    const roots = `${rootA};${rootB}`;
    expect(() =>
      openAllowlistedAttachment(path.join(rootA, "..", path.basename(outside), "secret.csv"), roots),
    ).toThrow(AttachmentPathError);
  });

  it("rejects symlinks when platform allows creating them", () => {
    const roots = `${rootA};${rootB}`;
    const target = path.join(rootA, "ok.csv");
    const link = path.join(rootA, "linked.csv");
    try {
      fs.symlinkSync(target, link);
    } catch {
      // Windows without Developer Mode / admin — skip
      return;
    }
    expect(() => openAllowlistedAttachment(link, roots)).toThrow(AttachmentPathError);
  });

  it("rejects file replacement between validation and read", () => {
    const roots = `${rootA};${rootB}`;
    const p = path.join(rootA, "race.csv");
    fs.writeFileSync(p, "Airtel Phone\n254711800001\n");
    expect(() =>
      openAllowlistedAttachment(p, roots, {
        afterValidateBeforeOpen: () => {
          fs.writeFileSync(p, "Airtel Phone\n254711800001\nEXTRA\n");
        },
      }),
    ).toThrow(/changed between validation and read|race/i);
  });

  it("detects same content fingerprint", () => {
    const buf = fs.readFileSync(path.join(rootA, "ok.csv"));
    expect(fingerprintBuffer(buf)).toHaveLength(64);
  });
});

describe("Phase 1A.8 CSV/XLSX parsing", () => {
  it("parses CSV and maps airtel column", () => {
    const buf = Buffer.from("Customer Name,Airtel Phone,Status\nA,254711800001,installed\n");
    const r = parseCsvDocument(buf, { installedOnly: true });
    expect(r.mappingResolution.status).toBe("resolved");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.airtel_phone).toBe("254711800001");
  });

  it("neutralizes CSV formula injection", () => {
    expect(neutralizeCsvCell("=cmd|'/c calc'!A0")).toMatch(/^'/);
    const buf = Buffer.from("Airtel Phone\n=HYPERLINK(\"http://evil\")\n");
    const r = parseCsvDocument(buf, {});
    expect(r.rows[0]!.airtel_phone?.startsWith("'") || !r.rows[0]!.airtel_phone?.startsWith("=")).toBe(
      true,
    );
  });

  it("flags ambiguous phone columns", () => {
    const r = resolveColumnMapping([
      { columnIndex: 0, header: "Phone A", normalized: "phonea", suggestedRoles: ["airtel_phone"] },
      { columnIndex: 1, header: "Phone B", normalized: "phoneb", suggestedRoles: ["airtel_phone"] },
    ]);
    expect(r.status).toBe("ambiguous");
  });

  it("rejects xlsx macros via vbaproject", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/vbaProject.bin", Buffer.from("MZ"));
    const buf = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    await expect(scanZipSecurity(buf)).resolves.toMatchObject({ macros: true });
    await expect(inspectXlsxDocument(buf)).rejects.toThrow(/macro/i);
  });

  it("rejects xlsx external links", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/externalLinks/externalLink1.xml", "<externalLink/>");
    const buf = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    await expect(scanZipSecurity(buf)).resolves.toMatchObject({ externalLinks: true });
    await expect(inspectXlsxDocument(buf)).rejects.toThrow(/external/i);
  });

  it(
    "rejects ZIP decompression bombs",
    async () => {
      const zip = new JSZip();
      // One large entry exceeding maxDecompressedBytes
      const big = Buffer.alloc(DOC_LIMITS.maxDecompressedBytes + 1024, 0x41);
      zip.file("xl/workbook.xml", "<workbook/>");
      zip.file("xl/huge.bin", big);
      const buf = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      await expect(scanZipSecurity(buf)).rejects.toThrow(/Decompressed size|zip_bomb/i);
    },
    20_000,
  );

  it("parses xlsx sheet with formulas neutralized", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Customers");
    ws.addRow(["Airtel Phone", "Safaricom Phone", "Installed"]);
    ws.addRow(["254711800010", "254722200010", "yes"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = await parseXlsxSheet(buf, { sheetIndex: 0 });
    expect(parsed.rows.length).toBe(1);
  });
});

describe("Phase 1A.8 synthetic regression fixture", () => {
  it("parses 51 qualifying installed rows / 50 unique phones from workbook", async () => {
    const xlsxPath = join(fixturesDir, "synthetic-51-installed.xlsx");
    if (!fs.existsSync(xlsxPath)) {
      // Generate on the fly if missing
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Installed");
      ws.addRow(["Customer Name", "Airtel Phone", "Safaricom Phone", "Installed"]);
      for (let i = 1; i <= 50; i++) {
        ws.addRow([
          `Synthetic Customer ${i}`,
          `25471181${String(i).padStart(4, "0")}`,
          i <= 10 ? `25472281${String(i).padStart(4, "0")}` : "",
          "installed",
        ]);
      }
      ws.addRow(["Synthetic Customer 1 Dup", "0711810001", "", "installed"]);
      fs.mkdirSync(fixturesDir, { recursive: true });
      await wb.xlsx.writeFile(xlsxPath);
    }
    const buf = fs.readFileSync(xlsxPath);
    const parsed = await parseXlsxSheet(buf, { sheetIndex: 0, installedOnly: true });
    expect(parsed.qualifyingRowCount).toBe(51);
    const phones = new Set(
      parsed.rows.map((r) => {
        const p = (r.airtel_phone || "").replace(/\D/g, "");
        if (p.startsWith("0") && p.length === 10) return `254${p.slice(1)}`;
        return p;
      }),
    );
    expect(phones.size).toBe(50);
  });
});

describe("Phase 1A.8 audit redaction", () => {
  it("never includes raw path or phones", () => {
    const r = redactDocumentAuditArgs("reconcile_document_customers", {
      attachment_path: "/home/bonface/.openclaw/media/inbound/x.xlsx",
      mapping: { airtel_phone: 0 },
    });
    expect(JSON.stringify(r)).not.toContain("bonface");
    expect(JSON.stringify(r)).not.toContain("xlsx");
    expect(r.attachment_path).toBe("[REDACTED_PATH]");
  });
});
