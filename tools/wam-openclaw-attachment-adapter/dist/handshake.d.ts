/**
 * Handshake v0.2.2 — plugin-only sequence binding on stock OpenClaw 2026.7.1-2.
 *
 * After file MR → instruction MR (same agent/session/account/peer/sender),
 * before_prompt_build may claim using sessionKey + peerId + runId when
 * instruction_observed is already set. Wrappers are always catalogued; if the
 * instruction prompt races ahead of message_received, execute waits briefly
 * then late-claims.
 *
 * This is sequence binding, not cryptographic message-to-prompt binding.
 */
import type { CapabilityStore } from "./capability-store.js";
import type { AttachmentBinding, TurnIdentity } from "./types.js";
import { type LifecycleLogger } from "./lifecycle-log.js";
export type HandshakePromptResult = {
    prependContext: string;
    phase: "pending_file_ack" | "claimed" | "none";
    claimed: boolean;
    reason?: string;
};
export declare function assertPromptTurnMatch(binding: AttachmentBinding, turn: TurnIdentity): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare function syncHandshakeForTurn(store: CapabilityStore, turn: TurnIdentity, nowMs?: number): HandshakePromptResult;
/**
 * Sync late-claim when instruction_observed is already set.
 * Does not wait — use resolveBindingForToolsAsync at execute time.
 */
export declare function bindingUsableForTools(store: CapabilityStore, turn: TurnIdentity, nowMs?: number): AttachmentBinding | null;
export declare function sleepMs(ms: number): Promise<void>;
/**
 * Poll until instruction_observed, invalidation, or timeout.
 * Async (await sleep) — does not block the event loop synchronously.
 */
export declare function waitForInstructionObserved(store: CapabilityStore, sessionKey: string, opts?: {
    maxWaitMs?: number;
    pollMs?: number;
    signal?: AbortSignal | null;
}): Promise<{
    ok: true;
    binding: AttachmentBinding;
} | {
    ok: false;
    reason: string;
}>;
export type ResolveBindingResult = {
    ok: true;
    binding: AttachmentBinding;
    lateClaim: boolean;
} | {
    ok: false;
    reason: string;
};
/**
 * Resolve a usable claimed binding for wrapper execution.
 * If pending but instruction_observed is racing, wait up to
 * INSTRUCTION_OBSERVE_WAIT_MS then late-claim.
 */
export declare function resolveBindingForToolsAsync(store: CapabilityStore, turn: TurnIdentity, opts?: {
    maxWaitMs?: number;
    pollMs?: number;
    logger?: LifecycleLogger;
    signal?: AbortSignal | null;
    nowMs?: number;
}): Promise<ResolveBindingResult>;
