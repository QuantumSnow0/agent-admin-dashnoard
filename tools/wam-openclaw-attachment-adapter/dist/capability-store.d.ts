/**
 * Process-local capability store (v0.2.1).
 * Restart clears all state (fail closed).
 *
 * Content digests (SHA-256) are reserved on first wrapper revalidation so
 * identical bytes under distinct inodes cannot be parsed/reconciled twice.
 */
import type { AttachmentBinding } from "./types.js";
/** Bound process-local content fingerprint table (never log full digests). */
export declare const MAX_CONTENT_FINGERPRINTS = 256;
export type ContentFingerprintEntry = {
    /** Full digest kept in-memory only; never log this value. */
    digest: string;
    capabilityId: string;
    sessionKey: string;
    agentId: string;
    expiresAtMs: number;
    /** reserved = live binding; result = consumed/invalidated (still blocks reuse). */
    status: "reserved" | "result";
};
export declare class CapabilityStore {
    private bySession;
    private byCapability;
    private inboundEpoch;
    private abandonedInbound;
    private contentByDigest;
    clear(): void;
    /** Test/diag only — never log returned digests in production paths. */
    contentFingerprintCount(): number;
    beginMessageReceived(sessionKey: string): number;
    abandonMessageReceived(sessionKey: string, generation: number): void;
    canCommitMessageReceived(sessionKey: string, generation: number, abortSignal?: AbortSignal | null): boolean;
    /** True if another live binding already holds this staged fingerprint. */
    findDuplicateStagedFingerprint(fp: string, exceptSessionKey?: string): AttachmentBinding | null;
    putPending(binding: AttachmentBinding, opts?: {
        inboundGeneration?: number;
        abortSignal?: AbortSignal | null;
    }): boolean;
    getRaw(sessionKey: string): AttachmentBinding | null;
    /** Pending or instruction_observed (awaiting claim). */
    getPending(sessionKey: string, nowMs?: number): AttachmentBinding | null;
    getActiveForSession(sessionKey: string, nowMs?: number): AttachmentBinding | null;
    observeInstructionMessage(sessionKey: string, input: {
        messageId: string;
        accountId: string;
        peerId: string;
        senderId: string;
    }, nowMs?: number, opts?: {
        inboundGeneration?: number;
        abortSignal?: AbortSignal | null;
    }): {
        ok: true;
        binding: AttachmentBinding;
    } | {
        ok: false;
        reason: string;
    };
    tryClaim(sessionKey: string, instructionRunId: string, nowMs?: number, opts?: {
        late?: boolean;
    }): {
        ok: true;
        binding: AttachmentBinding;
    } | {
        ok: false;
        reason: string;
    };
    /**
     * Atomically reserve or confirm a content digest after first SHA-256 pin.
     * Same capability may re-confirm; any other live/result reservation fails closed.
     */
    reserveContentDigest(binding: AttachmentBinding, digest: string, nowMs?: number): {
        ok: true;
    } | {
        ok: false;
        reason: string;
    };
    private markContentDigestResult;
    private evictExpiredContentFingerprints;
    consume(sessionKey: string, reason?: string): AttachmentBinding | null;
    invalidateSession(sessionKey: string, reason: string): void;
    onSessionReset(sessionKey: string): void;
    onRunEnd(_runId: string | null | undefined): void;
}
export declare const globalCapabilityStore: CapabilityStore;
