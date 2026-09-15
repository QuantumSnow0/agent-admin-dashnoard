/**
 * Attachment capability types — adapter v0.2.1 (plugin-only sequence binding).
 *
 * Trust model (explicitly weaker than cryptographic message-to-prompt binding):
 * file message_received → instruction message_received (same identity) →
 * sole subsequent before_prompt_build claims via sessionKey + peerId + runId.
 * Stock OpenClaw 2026.7.1-2 does not expose messageId on before_prompt_build;
 * that omission is accepted for the private bonface-owner Telegram session.
 *
 * See patches/PLUGIN-ONLY-SEQUENCE-BINDING.md and the runbook residual-risk section.
 */
export type CapabilityLifecycleState = "pending" | "instruction_observed" | "claimed" | "inspected" | "mapped" | "reconciled" | "consumed";
export type AttachmentBinding = {
    capabilityId: string;
    fileMessageId: string;
    accountId: string;
    peerId: string;
    senderId: string;
    agentId: string;
    sessionKey: string;
    sessionGeneration: string | null;
    /** Set on first subsequent text message_received after file capture. */
    instructionObserved: boolean;
    instructionObservedAtMs: number | null;
    instructionRunId: string | null;
    instructionMessageId: string | null;
    attachmentIndex: number;
    fileUniqueId: string | null;
    /** Host-only; never exposed to the model. */
    canonicalPath: string;
    displayFileName: string;
    mimeType: string | null;
    sizeBytes: number;
    deviceId: string | number;
    inode: string | number;
    nlink: number;
    mtimeMs: number;
    /** Empty until first tool revalidation hashes the file (outside message_received). */
    sha256: string;
    mintedAtMs: number;
    expiresAtMs: number;
    lifecycle: CapabilityLifecycleState;
    consumed: boolean;
    invalidatedReason: string | null;
    claimEpoch: number;
    lateClaimAttempts: number;
};
export type PendingCaptureInput = {
    fileMessageId: string;
    accountId: string;
    peerId: string;
    senderId: string;
    agentId: string;
    sessionKey: string;
    sessionGeneration?: string | null;
    attachmentIndex: number;
    fileUniqueId?: string | null;
    canonicalPath: string;
    displayFileName: string;
    mimeType?: string | null;
    sizeBytes: number;
    deviceId: string | number;
    inode: string | number;
    nlink: number;
    mtimeMs: number;
    sha256: string;
    ttlMs?: number;
};
export type QualifyingAttachment = {
    path: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    index: number;
    fileUniqueId?: string | null;
};
/**
 * Prompt/tool turn identity on stock OpenClaw.
 * Claim requires sessionKey + peerId + runId after instructionObserved.
 * messageId/accountId/senderId are used when present for fail-closed mismatch checks.
 */
export type TurnIdentity = {
    sessionKey: string;
    runId: string | null;
    messageId: string | null;
    accountId: string | null;
    peerId: string | null;
    senderId: string | null;
    agentId: string | null;
    sessionGeneration: string | null;
};
/** Maximum pending TTL: 120 seconds. */
export declare const PENDING_TTL_MS = 120000;
export declare const MAX_LATE_CLAIM_ATTEMPTS = 1;
/**
 * Bounded wait for async instruction message_received to reach
 * instruction_observed before wrapper late-claim (stock OpenClaw race).
 */
export declare const INSTRUCTION_OBSERVE_WAIT_MS = 500;
export declare const INSTRUCTION_OBSERVE_POLL_MS = 25;
/**
 * Verified production attachment roots (bonface-owner Telegram).
 * Runtime still requires WAM_ATTACHMENT_ROOTS to list these (or a test subset).
 */
export declare const VERIFIED_ATTACHMENT_ROOTS: readonly ["/home/bonface/.openclaw/media/inbound", "/home/bonface/.openclaw/workspaces/bonface-owner/media/inbound"];
export declare const WRAPPER_TOOL_NAMES: readonly ["inspect_current_business_document", "parse_current_document_customers", "reconcile_current_document_customers"];
export type WrapperToolName = (typeof WRAPPER_TOOL_NAMES)[number];
export declare const RAW_DOCUMENT_MCP_PREFIX = "wam.business.documents.";
export declare const OPENCLAW_VERSION_GUARD: {
    readonly allowedExact: readonly ["2026.7.1", "2026.7.1-1", "2026.7.1-2", "2026.7.2"];
    readonly minPrefix: "2026.7.1";
    readonly maxExclusivePrefix: "2026.8.0";
};
export declare const REQUIRED_PENDING_CAPTURE_FIELDS: readonly ["message_id", "account_id", "peer_id", "sender_id", "agent_id", "session_key", "staged_media_path"];
/** Claim fields required on stock before_prompt_build (no messageId). */
export declare const REQUIRED_CLAIM_TURN_FIELDS: readonly ["sessionKey", "peerId", "runId"];
