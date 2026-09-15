import type { AttachmentBinding, PendingCaptureInput } from "./types.js";
export declare function mintCapabilityId(): string;
export declare function sha256File(absolutePath: string): string;
export declare function lstatIdentity(absolutePath: string): {
    sizeBytes: number;
    deviceId: string | number;
    inode: string | number;
    nlink: number;
    mtimeMs: number;
    isFile: boolean;
    isSymlink: boolean;
};
export declare function mintPendingBinding(input: PendingCaptureInput, nowMs?: number): AttachmentBinding;
/**
 * Revalidate path identity before/after content read.
 * SHA-256 is deferred from message_received and pinned on first successful read.
 */
export declare function revalidateBindingFile(binding: AttachmentBinding): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/** Fingerprint key for duplicate staged-file detection (pre-hash). */
export declare function stagedFingerprintKey(b: {
    deviceId: string | number;
    inode: string | number;
    sizeBytes: number;
}): string;
