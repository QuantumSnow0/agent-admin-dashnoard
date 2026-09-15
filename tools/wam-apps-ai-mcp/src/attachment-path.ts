import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ALLOWED_EXTENSIONS, DENIED_BASENAME_RE, DOC_LIMITS } from "./document-limits.js";

export type AttachmentOpenResult = {
  fd: number;
  absolutePath: string;
  basename: string;
  rootIndex: number;
  size: number;
  mtimeMs: number;
  ino: bigint | number;
  contentFingerprint: string;
  buffer: Buffer;
};

export class AttachmentPathError extends Error {
  category: string;
  constructor(category: string, message: string) {
    super(message);
    this.category = category;
    this.name = "AttachmentPathError";
  }
}

function parseRoots(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s));
}

/** Lexical containment: resolved path is under root (after both are resolved). */
export function isPathInsideRoot(resolvedPath: string, resolvedRoot: string): boolean {
  const rel = path.relative(resolvedRoot, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function lstatStrict(p: string): fs.Stats {
  return fs.lstatSync(p);
}

/**
 * Validate every path component with lstat; reject symlinks and non-directories for parents.
 * Does not follow symlinks.
 */
export function assertSafePathComponents(absolutePath: string, roots: string[]): {
  rootIndex: number;
  finalStat: fs.Stats;
} {
  if (!path.isAbsolute(absolutePath)) {
    throw new AttachmentPathError("path_rejected", "Attachment path must be absolute");
  }
  if (absolutePath.includes("\0")) {
    throw new AttachmentPathError("path_rejected", "NUL in path");
  }

  const normalized = path.normalize(absolutePath);
  if (normalized !== absolutePath && path.normalize(absolutePath) !== path.resolve(absolutePath)) {
    // still proceed with resolve
  }
  const resolved = path.resolve(absolutePath);
  if (resolved.split(path.sep).includes("..")) {
    throw new AttachmentPathError("path_rejected", "Traversal segment rejected");
  }

  let rootIndex = -1;
  for (let i = 0; i < roots.length; i++) {
    if (isPathInsideRoot(resolved, roots[i]!)) {
      rootIndex = i;
      break;
    }
  }
  if (rootIndex < 0) {
    throw new AttachmentPathError("path_rejected", "Path outside allowlisted attachment roots");
  }

  const root = roots[rootIndex]!;
  // Walk from root to leaf
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AttachmentPathError("path_rejected", "Path outside allowlisted attachment roots");
  }
  const parts = rel === "" ? [] : rel.split(path.sep).filter(Boolean);
  let cur = root;
  const rootStat = lstatStrict(cur);
  if (rootStat.isSymbolicLink()) {
    throw new AttachmentPathError("path_rejected", "Attachment root must not be a symlink");
  }
  if (!rootStat.isDirectory()) {
    throw new AttachmentPathError("path_rejected", "Attachment root must be a directory");
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "." || part === "..") {
      throw new AttachmentPathError("path_rejected", "Traversal segment rejected");
    }
    cur = path.join(cur, part);
    const st = lstatStrict(cur);
    if (st.isSymbolicLink()) {
      throw new AttachmentPathError("path_rejected", "Symlinks are not allowed");
    }
    const isLast = i === parts.length - 1;
    if (isLast) {
      if (!st.isFile()) {
        throw new AttachmentPathError("path_rejected", "Attachment must be a regular file");
      }
      if (typeof st.nlink === "number" && st.nlink > 1) {
        throw new AttachmentPathError("path_rejected", "Hard-linked attachment rejected");
      }
      return { rootIndex, finalStat: st };
    }
    if (!st.isDirectory()) {
      throw new AttachmentPathError("path_rejected", "Non-directory path component");
    }
  }
  throw new AttachmentPathError("path_rejected", "Path did not resolve to a file");
}

export function assertAllowedBasename(basename: string): void {
  if (!basename || basename === "." || basename === "..") {
    throw new AttachmentPathError("path_rejected", "Invalid basename");
  }
  if (DENIED_BASENAME_RE.test(basename)) {
    throw new AttachmentPathError("path_rejected", "Denied file name pattern");
  }
  const ext = path.extname(basename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AttachmentPathError("unsupported_type", `Unsupported extension ${ext || "(none)"}`);
  }
}

export type OpenAttachmentOptions = {
  /** Test-only: mutate the file after validation and before open (TOCTOU race). */
  afterValidateBeforeOpen?: () => void;
};

/**
 * Open an allowlisted attachment with TOCTOU guards: lstat → open → fstat compare → read → close.
 */
export function openAllowlistedAttachment(
  requestedPath: string,
  attachmentRootsCsv: string | null | undefined,
  options?: OpenAttachmentOptions,
): AttachmentOpenResult {
  const roots = parseRoots(attachmentRootsCsv);
  if (roots.length === 0) {
    throw new AttachmentPathError("config", "WAM_AI_ATTACHMENT_ROOTS is not configured");
  }
  for (const r of roots) {
    if (!fs.existsSync(r)) {
      throw new AttachmentPathError("config", `Attachment root missing: ${r}`);
    }
  }

  const absolutePath = path.resolve(requestedPath);
  const basename = path.basename(absolutePath);
  assertAllowedBasename(basename);

  const { rootIndex, finalStat } = assertSafePathComponents(absolutePath, roots);
  if (finalStat.size > DOC_LIMITS.maxFileBytes) {
    throw new AttachmentPathError("oversized", "File exceeds maximum size");
  }
  if (finalStat.size <= 0) {
    throw new AttachmentPathError("empty", "Empty file");
  }

  options?.afterValidateBeforeOpen?.();

  const fd = fs.openSync(absolutePath, "r");
  try {
    const st2 = fs.fstatSync(fd);
    if (!st2.isFile()) {
      throw new AttachmentPathError("path_rejected", "Opened handle is not a regular file");
    }
    if (st2.size !== finalStat.size || st2.mtimeMs !== finalStat.mtimeMs) {
      throw new AttachmentPathError("race", "File changed between validation and read");
    }
    if (
      typeof st2.ino === "number" &&
      typeof finalStat.ino === "number" &&
      st2.ino !== finalStat.ino
    ) {
      throw new AttachmentPathError("race", "File identity changed between validation and read");
    }
    if (typeof st2.nlink === "number" && st2.nlink > 1) {
      throw new AttachmentPathError("path_rejected", "Hard-linked attachment rejected");
    }

    const buffer = Buffer.alloc(st2.size);
    const read = fs.readSync(fd, buffer, 0, st2.size, 0);
    if (read !== st2.size) {
      throw new AttachmentPathError("io", "Short read");
    }

    // Re-check after read
    const st3 = fs.fstatSync(fd);
    if (st3.size !== st2.size || st3.mtimeMs !== st2.mtimeMs) {
      throw new AttachmentPathError("race", "File changed during read");
    }

    const contentFingerprint = createHash("sha256").update(buffer).digest("hex");
    return {
      fd,
      absolutePath,
      basename,
      rootIndex,
      size: st2.size,
      mtimeMs: st2.mtimeMs,
      ino: st2.ino,
      contentFingerprint,
      buffer,
    };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

export function fingerprintBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export { parseRoots as parseAttachmentRoots };
