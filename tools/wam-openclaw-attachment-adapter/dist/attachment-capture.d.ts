import type { CapabilityStore } from "./capability-store.js";
import type { QualifyingAttachment } from "./types.js";
export declare function isQualifyingAttachment(att: {
    path?: string | null;
    mimeType?: string | null;
}): boolean;
export declare function extractCaptureFields(event: Record<string, unknown>): {
    messageId: string | null;
    accountId: string | null;
    peerId: string | null;
    senderId: string | null;
    sessionKey: string | null;
    runId: string | null;
    updateId: string | null;
    mediaStagingPending: boolean;
    qualifyingMediaPresent: boolean;
    stagedMediaPathPresent: boolean;
    attachments: QualifyingAttachment[];
    missingTrustedFields: string[];
};
export type CaptureResult = {
    status: "ignored";
    reason: string;
} | {
    status: "pending";
    capabilityId: string;
    attachmentIndex: number;
    lifecycle: "pending";
} | {
    status: "error";
    reason: string;
    missingTrustedFields?: string[];
};
/**
 * File-message capture → pending (v0.1.3).
 * Does not require runId, update_id, or file_unique_id.
 * Instruction observation is handled by processMessageReceivedSequence.
 */
export declare function capturePendingAttachment(store: CapabilityStore, event: Record<string, unknown>, opts: {
    agentId: string;
    attachmentRoots: string[];
    sessionGeneration?: string | null;
    attachmentIndex?: number;
    nowMs?: number;
    inboundGeneration?: number;
    abortSignal?: AbortSignal | null;
}): CaptureResult;
/** @deprecated Use capturePendingAttachment — kept for test migration aliases. */
export declare function captureStagedAttachment(store: CapabilityStore, event: Record<string, unknown>, opts: {
    agentId: string;
    attachmentRoots?: string[];
    sessionGeneration?: string | null;
    attachmentIndex?: number;
    nowMs?: number;
}): CaptureResult;
export declare function buildFileAckPromptHint(): string;
/**
 * Neutral guidance while a spreadsheet may be pending and instruction_observed
 * may still be racing the prompt/tool catalogue (stock OpenClaw live order).
 */
export declare function buildPendingRacePromptHint(): string;
export declare function buildClaimedPromptHint(): string;
export declare function buildNoAttachmentPromptHint(): string;
/** @deprecated */
export declare function buildAttachmentPromptHint(hasActive: boolean): string;
