/**
 * Write PACKAGE-FILE-CHECKSUMS.txt for a package root (packaged files only).
 * Does not hash the archive itself (external .sha256 files do that).
 * Does not hash PACKAGE-FILE-CHECKSUMS.txt (self).
 */
import { createHash } from "node:crypto";
import { createReadStream, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("Usage: node write-package-file-checksums.mjs <package-root>");
  process.exit(1);
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "_stage",
  "coverage",
  ".turbo",
  ".cache",
]);

const SKIP_FILES = new Set(["PACKAGE-FILE-CHECKSUMS.txt"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) {
      if (SKIP_FILES.has(name)) continue;
      if (name.endsWith(".sha256")) continue;
      if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) continue;
      out.push(p);
    }
  }
  return out;
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(path);
    s.on("data", (c) => h.update(c));
    s.on("error", reject);
    s.on("end", () => resolve(h.digest("hex").toUpperCase()));
  });
}

const files = walk(root).sort((a, b) => a.localeCompare(b));
const lines = [
  "# Packaged-file SHA-256 checksums (not the archive).",
  "# Verify archive integrity with the sibling external *.sha256 file.",
  "",
];

for (const f of files) {
  const hash = await sha256File(f);
  const rel = relative(root, f).split(sep).join("/");
  lines.push(`${hash}  ${rel}`);
}

const outPath = join(root, "PACKAGE-FILE-CHECKSUMS.txt");
writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
console.log(`wrote ${outPath} (${files.length} files)`);
