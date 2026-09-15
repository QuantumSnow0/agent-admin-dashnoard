/**
 * message_received sequence processor for v0.1.3.
 *
 * Live OpenClaw: message_received has messageId/sessionKey/accountId/peerId/senderId
 * and may carry media. Text-only events must not be no-ops when pending exists.
 */
import { capturePendingAttachment, extractCaptureFields, } from "./attachment-capture.js";
/**
 * Synchronously advance the two-message sequence from a message_received event.
 */
export function processMessageReceivedSequence(store, event, opts) {
    const nowMs = opts.nowMs ?? Date.now();
    const extracted = extractCaptureFields(event);
    // Qualifying attachment → pending (replaces any prior).
    if (!extracted.mediaStagingPending &&
        extracted.attachments.length > 0) {
        return capturePendingAttachment(store, event, {
            ...opts,
            inboundGeneration: opts.inboundGeneration,
            abortSignal: opts.abortSignal,
        });
    }
    // Staging-only: ignore (no sequence advance).
    if (extracted.mediaStagingPending) {
        return { status: "ignored", reason: "media_staging_pending" };
    }
    // Text-only / non-qualifying: must interact with pending if present.
    const sessionKey = extracted.sessionKey;
    if (!sessionKey) {
        return { status: "ignored", reason: "no_session_key" };
    }
    const pending = store.getPending(sessionKey, nowMs);
    if (!pending) {
        // No pending — nothing to observe (also covers post-claim third messages
        // that arrive after consume; active claimed handled below).
        const active = store.getActiveForSession(sessionKey, nowMs);
        if (active) {
            store.invalidateSession(sessionKey, "intervening_message_after_claim");
            return { status: "invalidated", reason: "intervening_message_after_claim" };
        }
        return { status: "ignored", reason: "no_pending_attachment" };
    }
    if (!extracted.messageId ||
        !extracted.accountId ||
        !extracted.peerId ||
        !extracted.senderId) {
        store.invalidateSession(sessionKey, "instruction_identity_incomplete");
        return {
            status: "invalidated",
            reason: "instruction_identity_incomplete",
        };
    }
    // Same message id as file (duplicate delivery) — leave pending.
    if (extracted.messageId === pending.fileMessageId) {
        return { status: "ignored", reason: "duplicate_file_message" };
    }
    const observed = store.observeInstructionMessage(sessionKey, {
        messageId: extracted.messageId,
        accountId: extracted.accountId,
        peerId: extracted.peerId,
        senderId: extracted.senderId,
    }, nowMs, { inboundGeneration: opts.inboundGeneration, abortSignal: opts.abortSignal });
    if (!observed.ok) {
        return {
            status: "invalidated",
            reason: observed.reason,
        };
    }
    return {
        status: "instruction_observed",
        instructionMessageId: extracted.messageId,
    };
}
