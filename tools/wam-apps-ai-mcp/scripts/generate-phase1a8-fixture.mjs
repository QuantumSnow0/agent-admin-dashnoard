/**
 * Generates synthetic Phase 1A.8 regression workbook (no real customer data).
 * Semantics: 51 qualifying installed rows, 50 unique, 1 duplicate.
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "phase1a8");
fs.mkdirSync(dir, { recursive: true });

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Installed");
ws.addRow(["Customer Name", "Airtel Phone", "Safaricom Phone", "Installed"]);

for (let i = 1; i <= 50; i++) {
  const airtel = `25471181${String(i).padStart(4, "0")}`;
  const saf = i <= 10 ? `25472281${String(i).padStart(4, "0")}` : "";
  ws.addRow([`Synthetic Customer ${i}`, airtel, saf, "installed"]);
}
// duplicate of customer 1
ws.addRow(["Synthetic Customer 1 Dup", "0711810001", "", "installed"]);

const out = path.join(dir, "synthetic-51-installed.xlsx");
await wb.xlsx.writeFile(out);
console.log("wrote", out);
