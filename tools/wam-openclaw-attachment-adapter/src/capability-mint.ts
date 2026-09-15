import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import type { AttachmentBinding, PendingCaptureInput } from "./types.js";
import { PENDING_TTL_MS } from "./types.js";

export function mintCapabilityId(): string {
  return `wam-attcap-${randomBytes(24).toString("base64url")}`;
}

export function sha256File(absolutePath: string): string {
  const buf = fs.readFileSync(absolutePath);
  return createHash("sha256").update(buf).digest("hex");
}

export function lstatIdentity(absolutePath: string): {
  sizeBytes: number;
  deviceId: string | number;
  inode: string | number;
  nlink: number;
  mtimeMs: number;
  isFile: boolean;
  isSymlink: boolean;
} {
  const st = fs.lstatSync(absolutePath);
  return {
    sizeBytes: st.size,
    deviceId: st.dev,
    inode: st.ino,
    nlink: st.nlink,
    mtimeMs: st.mtimeMs,
    isFile: st.isFile(),
    isSymlink: st.isSymbolicLink(),
  };
}

export function mintPendingBinding(
  input: PendingCaptureInput,
  nowMs = Date.now(),
): AttachmentBinding {
  const ttl = input.ttlMs ?? PENDING_TTL_MS;
  return {
    capabilityId: mintCapabilityId(),
    fileMessageId: input.fileMessageId,
    accountId: input.accountId,
    peerId: input.peerId,
    senderId: input.senderId,
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    sessionGeneration: input.sessionGeneration ?? null,
    instructionObserved: false,
    instructionObservedAtMs: null,
    instructionRunId: null,
    instructionMessageId: null,
    attachmentIndex: input.attachmentIndex,
    fileUniqueId: input.fileUniqueId ?? null,
    canonicalPath: input.canonicalPath,
    displayFileName: input.displayFileName,
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes,
    deviceId: input.deviceId,
    inode: input.inode,
    nlink: input.nlink,
    mtimeMs: input.mtimeMs,
    sha256: input.sha256,
    mintedAtMs: nowMs,
    expiresAtMs: nowMs + ttl,
    lifecycle: "pending",
    consumed: false,
    invalidatedReason: null,
    claimEpoch: 0,
    lateClaimAttempts: 0,
  };
}

function identityMatches(
  binding: AttachmentBinding,
  id: ReturnType<typeof lstatIdentity>,
): { ok: true } | { ok: false; reason: string } {
  if (id.isSymlink) return { ok: false, reason: "symlink_rejected" };
  if (!id.isFile) return { ok: false, reason: "not_regular_file" };
  if (id.nlink > 1) return { ok: false, reason: "hard_link_rejected" };
  if (id.sizeBytes !== binding.sizeBytes) return { ok: false, reason: "size_mismatch" };
  if (String(id.inode) !== String(binding.inode)) {
    return { ok: false, reason: "inode_mismatch" };
  }
  if (String(id.deviceId) !== String(binding.deviceId)) {
    return { ok: false, reason: "device_mismatch" };
  }
  if (id.mtimeMs !== binding.mtimeMs) return { ok: false, reason: "mtime_mismatch" };
  return { ok: true };
}

/**
 * Revalidate path identity before/after content read.
 * SHA-256 is deferred from message_received and pinned on first successful read.
 */
export function revalidateBindingFile(binding: AttachmentBinding): {
  ok: true;
} | {
  ok: false;
  reason: string;
} {
  try {
    const before = lstatIdentity(binding.canonicalPath);
    const pre = identityMatches(binding, before);
    if (!pre.ok) return pre;

    const digest = sha256File(binding.canonicalPath);

    const after = lstatIdentity(binding.canonicalPath);
    const post = identityMatches(binding, after);
    if (!post.ok) return { ok: false, reason: "toctou_" + post.reason };

    if (!binding.sha256) {
      binding.sha256 = digest;
    } else if (digest !== binding.sha256) {
      return { ok: false, reason: "digest_mismatch" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "file_unreadable" };
  }
}

/** Fingerprint key for duplicate staged-file detection (pre-hash). */
export function stagedFingerprintKey(b: {
  deviceId: string | number;
  inode: string | number;
  sizeBytes: number;
}): string {
  return `${b.deviceId}:${b.inode}:${b.sizeBytes}`;
}
