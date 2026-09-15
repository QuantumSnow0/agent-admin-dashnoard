/**
 * Attachment root containment + lstat/realpath/no-symlink/hard-link/TOCTOU helpers.
 * Mirrors MCP allowlist policy for the two approved OpenClaw inbound roots.
 */
import fs from "node:fs";
import path from "node:path";
export class AttachmentRootError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = "AttachmentRootError";
    }
}
export function parseAttachmentRoots(raw) {
    if (!raw?.trim())
        return [];
    return raw
        .split(/[:;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => path.resolve(s));
}
export function resolveAttachmentRootsFromEnv(env = process.env) {
    return parseAttachmentRoots(env.WAM_ATTACHMENT_ROOTS ?? env.WAM_AI_ATTACHMENT_ROOTS ?? null);
}
export function isPathInsideRoot(resolvedPath, resolvedRoot) {
    const rel = path.relative(resolvedRoot, resolvedPath);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
/**
 * Validate staged path is under an allowlisted root, is a regular file,
 * not a symlink, and not hard-linked (nlink > 1).
 */
export function assertSafeStagedAttachmentPath(requestedPath, roots) {
    if (!roots.length) {
        throw new AttachmentRootError("roots_not_configured", "WAM_ATTACHMENT_ROOTS / WAM_AI_ATTACHMENT_ROOTS is not configured");
    }
    if (!path.isAbsolute(requestedPath)) {
        throw new AttachmentRootError("path_rejected", "Attachment path must be absolute");
    }
    if (requestedPath.includes("\0")) {
        throw new AttachmentRootError("path_rejected", "NUL in path");
    }
    const absolutePath = path.resolve(requestedPath);
    let rootIndex = -1;
    for (let i = 0; i < roots.length; i++) {
        if (isPathInsideRoot(absolutePath, roots[i])) {
            rootIndex = i;
            break;
        }
    }
    if (rootIndex < 0) {
        throw new AttachmentRootError("path_outside_roots", "Path outside allowlisted attachment roots");
    }
    const root = roots[rootIndex];
    const rel = path.relative(root, absolutePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new AttachmentRootError("path_outside_roots", "Path outside allowlisted attachment roots");
    }
    // realpath check: reject if realpath escapes root (symlink-following detect)
    let real;
    try {
        real = fs.realpathSync.native
            ? fs.realpathSync.native(absolutePath)
            : fs.realpathSync(absolutePath);
    }
    catch {
        throw new AttachmentRootError("unreadable_path", "realpath failed");
    }
    if (!isPathInsideRoot(real, root)) {
        throw new AttachmentRootError("realpath_outside_roots", "realpath escaped attachment root");
    }
    const parts = rel === "" ? [] : rel.split(path.sep).filter(Boolean);
    let cur = root;
    const rootStat = fs.lstatSync(cur);
    if (rootStat.isSymbolicLink()) {
        throw new AttachmentRootError("path_rejected", "Attachment root must not be a symlink");
    }
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === "." || part === "..") {
            throw new AttachmentRootError("path_rejected", "Traversal segment rejected");
        }
        cur = path.join(cur, part);
        const st = fs.lstatSync(cur);
        if (st.isSymbolicLink()) {
            throw new AttachmentRootError("symlink_rejected", "Symlinks are not allowed");
        }
        const isLast = i === parts.length - 1;
        if (isLast) {
            if (!st.isFile()) {
                throw new AttachmentRootError("not_regular_file", "Attachment must be a regular file");
            }
            if (typeof st.nlink === "number" && st.nlink > 1) {
                throw new AttachmentRootError("hard_link_rejected", "Hard-linked attachment rejected");
            }
            return {
                absolutePath,
                sizeBytes: st.size,
                deviceId: st.dev,
                inode: st.ino,
                nlink: st.nlink,
                mtimeMs: st.mtimeMs,
            };
        }
        if (!st.isDirectory()) {
            throw new AttachmentRootError("path_rejected", "Non-directory path component");
        }
    }
    throw new AttachmentRootError("path_rejected", "Path did not resolve to a file");
}
