/** Phase 1A.8 document intake hard limits. */
export const DOC_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxDecompressedBytes: 25 * 1024 * 1024,
  maxZipEntries: 2000,
  maxSheets: 20,
  maxRowsPerSheet: 5000,
  maxColumns: 64,
  maxCellChars: 512,
  maxParseMs: 30_000,
  maxReconcileChunk: 250,
  maxSessionRows: 5000,
  sessionTtlMinutes: 30,
} as const;

export const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx"]);

/** Basename patterns never accepted even under allowlisted roots. */
export const DENIED_BASENAME_RE =
  /(\.env|\.pem|\.key|\.p12|\.pfx|id_rsa|id_ed25519|credentials?|secret|passwd|shadow|\.exe|\.bat|\.cmd|\.ps1|\.sh|\.js|\.mjs|\.cjs|\.ts|\.py|\.php|\.jar|\.dll|\.so)(\.|$)/i;
