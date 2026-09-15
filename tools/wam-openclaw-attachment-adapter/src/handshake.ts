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
import {
  INSTRUCTION_OBSERVE_POLL_MS,
  INSTRUCTION_OBSERVE_WAIT_MS,
} from "./types.js";
import {
  buildClaimedPromptHint,
  buildNoAttachmentPromptHint,
  buildPendingRacePromptHint,
} from "./attachment-capture.js";
import {
  logAttachmentLifecycle,
  type LifecycleLogger,
} from "./lifecycle-log.js";

export type HandshakePromptResult = {
  prependContext: string;
  phase: "pending_file_ack" | "claimed" | "none";
  claimed: boolean;
  reason?: string;
};

export function assertPromptTurnMatch(
  binding: AttachmentBinding,
  turn: TurnIdentity,
): { ok: true } | { ok: false; reason: string } {
  if (turn.sessionKey !== binding.sessionKey) {
    return { ok: false, reason: "session_mismatch" };
  }
  if (!turn.peerId || turn.peerId !== binding.peerId) {
    return { ok: false, reason: "peer_mismatch" };
  }
  if (turn.accountId != null && turn.accountId !== binding.accountId) {
    return { ok: false, reason: "account_mismatch" };
  }
  if (turn.senderId != null && turn.senderId !== binding.senderId) {
    return { ok: false, reason: "sender_mismatch" };
  }
  if (turn.agentId != null && turn.agentId !== binding.agentId) {
    return { ok: false, reason: "agent_mismatch" };
  }
  return { ok: true };
}

export function syncHandshakeForTurn(
  store: CapabilityStore,
  turn: TurnIdentity,
  nowMs = Date.now(),
): HandshakePromptResult {
  if (!turn.sessionKey) {
    return {
      prependContext: buildNoAttachmentPromptHint(),
      phase: "none",
      claimed: false,
      reason: "no_session",
    };
  }

  const pending = store.getPending(turn.sessionKey, nowMs);
  const active = store.getActiveForSession(turn.sessionKey, nowMs);

  if (pending) {
    const id = assertPromptTurnMatch(pending, turn);
    if (!id.ok) {
      store.invalidateSession(turn.sessionKey, id.reason);
      return {
        prependContext: buildNoAttachmentPromptHint(),
        phase: "none",
        claimed: false,
        reason: id.reason,
      };
    }

    if (!turn.runId || !turn.peerId) {
      return {
        prependContext: buildNoAttachmentPromptHint(),
        phase: "none",
        claimed: false,
        reason: "claim_fields_missing",
      };
    }

    // Instruction MR may still be racing — do not tell the model this is
    // merely a file-ack turn. Neutral guidance + always-visible wrappers.
    if (!pending.instructionObserved) {
      return {
        prependContext: buildPendingRacePromptHint(),
        phase: "pending_file_ack",
        claimed: false,
        reason: "instruction_not_observed",
      };
    }

    const claim = store.tryClaim(turn.sessionKey, turn.runId, nowMs);
    if (!claim.ok) {
      if (claim.reason === "already_claimed_by_other_run") {
        store.invalidateSession(turn.sessionKey, "intervening_or_stale_claim");
      }
      return {
        prependContext: buildNoAttachmentPromptHint(),
        phase: "none",
        claimed: false,
        reason: claim.reason,
      };
    }

    return {
      prependContext: buildClaimedPromptHint(),
      phase: "claimed",
      claimed: true,
    };
  }

  if (active) {
    if (!turn.runId || turn.runId !== active.instructionRunId) {
      store.invalidateSession(turn.sessionKey, "run_mismatch");
      return {
        prependContext: buildNoAttachmentPromptHint(),
        phase: "none",
        claimed: false,
        reason: "run_mismatch",
      };
    }
    const id = assertPromptTurnMatch(active, turn);
    if (!id.ok) {
      store.invalidateSession(turn.sessionKey, id.reason);
      return {
        prependContext: buildNoAttachmentPromptHint(),
        phase: "none",
        claimed: false,
        reason: id.reason,
      };
    }
    return {
      prependContext: buildClaimedPromptHint(),
      phase: "claimed",
      claimed: true,
    };
  }

  return {
    prependContext: buildNoAttachmentPromptHint(),
    phase: "none",
    claimed: false,
    reason: "no_binding",
  };
}

/**
 * Sync late-claim when instruction_observed is already set.
 * Does not wait — use resolveBindingForToolsAsync at execute time.
 */
export function bindingUsableForTools(
  store: CapabilityStore,
  turn: TurnIdentity,
  nowMs = Date.now(),
): AttachmentBinding | null {
  if (!turn.sessionKey || !turn.runId || !turn.peerId) return null;

  const active = store.getActiveForSession(turn.sessionKey, nowMs);
  if (active) {
    if (active.instructionRunId !== turn.runId) return null;
    const id = assertPromptTurnMatch(active, turn);
    if (!id.ok) return null;
    return active;
  }

  const pending = store.getPending(turn.sessionKey, nowMs);
  if (!pending?.instructionObserved) return null;
  const id = assertPromptTurnMatch(pending, turn);
  if (!id.ok) return null;

  const claim = store.tryClaim(turn.sessionKey, turn.runId, nowMs, {
    late: true,
  });
  if (!claim.ok) return null;
  return claim.binding;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until instruction_observed, invalidation, or timeout.
 * Async (await sleep) — does not block the event loop synchronously.
 */
export async function waitForInstructionObserved(
  store: CapabilityStore,
  sessionKey: string,
  opts?: {
    maxWaitMs?: number;
    pollMs?: number;
    signal?: AbortSignal | null;
  },
): Promise<
  | { ok: true; binding: AttachmentBinding }
  | { ok: false; reason: string }
> {
  const maxWait = opts?.maxWaitMs ?? INSTRUCTION_OBSERVE_WAIT_MS;
  const poll = opts?.pollMs ?? INSTRUCTION_OBSERVE_POLL_MS;
  const started = Date.now();

  while (Date.now() - started <= maxWait) {
    if (opts?.signal?.aborted) {
      return { ok: false, reason: "aborted" };
    }
    const pending = store.getPending(sessionKey);
    if (!pending) {
      const active = store.getActiveForSession(sessionKey);
      if (active?.instructionObserved) {
        return { ok: true, binding: active };
      }
      return { ok: false, reason: "no_pending" };
    }
    if (pending.instructionObserved) {
      return { ok: true, binding: pending };
    }
    await sleepMs(poll);
  }
  return { ok: false, reason: "wait_timeout" };
}

export type ResolveBindingResult =
  | { ok: true; binding: AttachmentBinding; lateClaim: boolean }
  | { ok: false; reason: string };

/**
 * Resolve a usable claimed binding for wrapper execution.
 * If pending but instruction_observed is racing, wait up to
 * INSTRUCTION_OBSERVE_WAIT_MS then late-claim.
 */
export async function resolveBindingForToolsAsync(
  store: CapabilityStore,
  turn: TurnIdentity,
  opts?: {
    maxWaitMs?: number;
    pollMs?: number;
    logger?: LifecycleLogger;
    signal?: AbortSignal | null;
    nowMs?: number;
  },
): Promise<ResolveBindingResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  if (!turn.sessionKey || !turn.runId || !turn.peerId) {
    return { ok: false, reason: "claim_fields_missing" };
  }

  const already = bindingUsableForTools(store, turn, nowMs);
  if (already) {
    return { ok: true, binding: already, lateClaim: false };
  }

  const pending = store.getPending(turn.sessionKey, nowMs);
  if (!pending) {
    return { ok: false, reason: "no_pending" };
  }

  const id = assertPromptTurnMatch(pending, turn);
  if (!id.ok) {
    store.invalidateSession(turn.sessionKey, id.reason);
    logAttachmentLifecycle(opts?.logger, "invalidated", {
      sessionKey: turn.sessionKey,
      reason: id.reason,
    });
    return { ok: false, reason: id.reason };
  }

  if (!pending.instructionObserved) {
    const waited = await waitForInstructionObserved(store, turn.sessionKey, {
      maxWaitMs: opts?.maxWaitMs,
      pollMs: opts?.pollMs,
      signal: opts?.signal,
    });
    if (!waited.ok) {
      if (waited.reason === "wait_timeout") {
        logAttachmentLifecycle(opts?.logger, "wait_timeout", {
          sessionKey: turn.sessionKey,
          reason: "instruction_not_observed",
        });
      } else if (waited.reason !== "no_pending") {
        logAttachmentLifecycle(opts?.logger, "invalidated", {
          sessionKey: turn.sessionKey,
          reason: waited.reason,
        });
      }
      return { ok: false, reason: waited.reason };
    }
    const afterId = assertPromptTurnMatch(waited.binding, turn);
    if (!afterId.ok) {
      store.invalidateSession(turn.sessionKey, afterId.reason);
      logAttachmentLifecycle(opts?.logger, "invalidated", {
        sessionKey: turn.sessionKey,
        reason: afterId.reason,
      });
      return { ok: false, reason: afterId.reason };
    }
  }

  const claim = store.tryClaim(turn.sessionKey, turn.runId, Date.now(), {
    late: true,
  });
  if (!claim.ok) {
    if (claim.reason === "already_claimed_by_other_run") {
      store.invalidateSession(turn.sessionKey, "intervening_or_stale_claim");
      logAttachmentLifecycle(opts?.logger, "invalidated", {
        sessionKey: turn.sessionKey,
        reason: "intervening_or_stale_claim",
      });
    }
    return { ok: false, reason: claim.reason };
  }

  logAttachmentLifecycle(opts?.logger, "late_claim_success", {
    sessionKey: turn.sessionKey,
  });
  return { ok: true, binding: claim.binding, lateClaim: true };
}
