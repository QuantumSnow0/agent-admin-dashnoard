import type { CapabilityStore } from "./capability-store.js";
import type { AttachmentBinding, TurnIdentity } from "./types.js";
export type BindingCheckFailure = {
    ok: false;
    reason: string;
};
export type BindingCheckSuccess = {
    ok: true;
};
/**
 * Full actor identity — for message_received observation only.
 */
export declare function assertMessageIdentityMatch(binding: AttachmentBinding, identity: {
    sessionKey: string;
    accountId: string;
    peerId: string;
    senderId: string;
    agentId?: string | null;
}): BindingCheckSuccess | BindingCheckFailure;
/** @deprecated Prefer assertMessageIdentityMatch / assertPromptTurnMatch. */
export declare function assertPendingIdentityMatch(binding: AttachmentBinding, turn: TurnIdentity): BindingCheckSuccess | BindingCheckFailure;
/**
 * Claimed-run checks for wrapper tools: exact instruction runId + prompt
 * identity (session/peer) + file revalidation + content-digest reservation.
 */
export declare function assertBindingMatchesTurn(binding: AttachmentBinding, turn: TurnIdentity, nowMs?: number, store?: CapabilityStore): BindingCheckSuccess | BindingCheckFailure;
