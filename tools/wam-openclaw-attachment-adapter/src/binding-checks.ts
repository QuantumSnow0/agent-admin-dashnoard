import { revalidateBindingFile } from "./capability-mint.js";
import type { CapabilityStore } from "./capability-store.js";
import type { AttachmentBinding, TurnIdentity } from "./types.js";
import { assertPromptTurnMatch } from "./handshake.js";

export type BindingCheckFailure = {
  ok: false;
  reason: string;
};

export type BindingCheckSuccess = { ok: true };

/**
 * Full actor identity — for message_received observation only.
 */
export function assertMessageIdentityMatch(
  binding: AttachmentBinding,
  identity: {
    sessionKey: string;
    accountId: string;
    peerId: string;
    senderId: string;
    agentId?: string | null;
  },
): BindingCheckSuccess | BindingCheckFailure {
  if (identity.sessionKey !== binding.sessionKey) {
    return { ok: false, reason: "session_mismatch" };
  }
  if (identity.accountId !== binding.accountId) {
    return { ok: false, reason: "account_mismatch" };
  }
  if (identity.peerId !== binding.peerId) {
    return { ok: false, reason: "peer_mismatch" };
  }
  if (identity.senderId !== binding.senderId) {
    return { ok: false, reason: "sender_mismatch" };
  }
  if (identity.agentId != null && identity.agentId !== binding.agentId) {
    return { ok: false, reason: "agent_mismatch" };
  }
  return { ok: true };
}

/** @deprecated Prefer assertMessageIdentityMatch / assertPromptTurnMatch. */
export function assertPendingIdentityMatch(
  binding: AttachmentBinding,
  turn: TurnIdentity,
): BindingCheckSuccess | BindingCheckFailure {
  if (turn.sessionKey !== binding.sessionKey) {
    return { ok: false, reason: "session_mismatch" };
  }
  if (turn.accountId != null && turn.accountId !== binding.accountId) {
    return { ok: false, reason: "account_mismatch" };
  }
  if (turn.peerId != null && turn.peerId !== binding.peerId) {
    return { ok: false, reason: "peer_mismatch" };
  }
  if (turn.senderId != null && turn.senderId !== binding.senderId) {
    return { ok: false, reason: "sender_mismatch" };
  }
  if (turn.agentId != null && turn.agentId !== binding.agentId) {
    return { ok: false, reason: "agent_mismatch" };
  }
  return { ok: true };
}

/**
 * Claimed-run checks for wrapper tools: exact instruction runId + prompt
 * identity (session/peer) + file revalidation + content-digest reservation.
 */
export function assertBindingMatchesTurn(
  binding: AttachmentBinding,
  turn: TurnIdentity,
  nowMs = Date.now(),
  store?: CapabilityStore,
): BindingCheckSuccess | BindingCheckFailure {
  if (binding.consumed || binding.invalidatedReason) {
    return { ok: false, reason: "consumed_or_invalid" };
  }
  if (
    binding.lifecycle === "pending" ||
    binding.lifecycle === "instruction_observed"
  ) {
    return { ok: false, reason: "still_pending" };
  }
  if (binding.expiresAtMs < nowMs) {
    return { ok: false, reason: "expiry" };
  }
  const id = assertPromptTurnMatch(binding, turn);
  if (!id.ok) return id;

  if (!turn.runId) {
    return { ok: false, reason: "turn_run_id_missing" };
  }
  if (!binding.instructionRunId) {
    return { ok: false, reason: "not_claimed" };
  }
  if (turn.runId !== binding.instructionRunId) {
    return { ok: false, reason: "run_mismatch" };
  }
  if (
    turn.sessionGeneration != null &&
    binding.sessionGeneration != null &&
    turn.sessionGeneration !== binding.sessionGeneration
  ) {
    return { ok: false, reason: "session_generation_mismatch" };
  }
  if (
    binding.attachmentIndex == null ||
    binding.attachmentIndex < 0 ||
    !Number.isInteger(binding.attachmentIndex)
  ) {
    return { ok: false, reason: "attachment_index_invalid" };
  }

  const file = revalidateBindingFile(binding);
  if (!file.ok) {
    return { ok: false, reason: file.reason };
  }
  if (store && binding.sha256) {
    const reserved = store.reserveContentDigest(binding, binding.sha256, nowMs);
    if (!reserved.ok) {
      return { ok: false, reason: reserved.reason };
    }
  }
  return { ok: true };
}
