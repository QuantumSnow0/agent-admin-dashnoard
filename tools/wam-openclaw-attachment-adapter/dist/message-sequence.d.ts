/**
 * message_received sequence processor for v0.1.3.
 *
 * Live OpenClaw: message_received has messageId/sessionKey/accountId/peerId/senderId
 * and may carry media. Text-only events must not be no-ops when pending exists.
 */
import { type CaptureResult } from "./attachment-capture.js";
import type { CapabilityStore } from "./capability-store.js";
export type SequenceResult = CaptureResult | {
    status: "instruction_observed";
    instructionMessageId: string;
} | {
    status: "invalidated";
    reason: string;
};
/**
 * Synchronously advance the two-message sequence from a message_received event.
 */
export declare function processMessageReceivedSequence(store: CapabilityStore, event: Record<string, unknown>, opts: {
    agentId: string;
    attachmentRoots: string[];
    sessionGeneration?: string | null;
    nowMs?: number;
    inboundGeneration?: number;
    abortSignal?: AbortSignal | null;
}): SequenceResult;
