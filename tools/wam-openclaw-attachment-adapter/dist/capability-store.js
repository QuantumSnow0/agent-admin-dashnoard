import { MAX_LATE_CLAIM_ATTEMPTS, PENDING_TTL_MS } from "./types.js";
import { stagedFingerprintKey } from "./capability-mint.js";
const AWAITING_CLAIM = new Set(["pending", "instruction_observed"]);
/** Bound process-local content fingerprint table (never log full digests). */
export const MAX_CONTENT_FINGERPRINTS = 256;
export class CapabilityStore {
    bySession = new Map();
    byCapability = new Map();
    inboundEpoch = new Map();
    abandonedInbound = new Set();
    contentByDigest = new Map();
    clear() {
        this.bySession.clear();
        this.byCapability.clear();
        this.inboundEpoch.clear();
        this.abandonedInbound.clear();
        this.contentByDigest.clear();
    }
    /** Test/diag only — never log returned digests in production paths. */
    contentFingerprintCount() {
        return this.contentByDigest.size;
    }
    beginMessageReceived(sessionKey) {
        const key = sessionKey.trim();
        const next = (this.inboundEpoch.get(key) ?? 0) + 1;
        this.inboundEpoch.set(key, next);
        return next;
    }
    abandonMessageReceived(sessionKey, generation) {
        this.abandonedInbound.add(`${sessionKey.trim()}:${generation}`);
    }
    canCommitMessageReceived(sessionKey, generation, abortSignal) {
        if (abortSignal?.aborted)
            return false;
        const key = sessionKey.trim();
        if (this.abandonedInbound.has(`${key}:${generation}`))
            return false;
        if (this.inboundEpoch.get(key) !== generation)
            return false;
        return true;
    }
    /** True if another live binding already holds this staged fingerprint. */
    findDuplicateStagedFingerprint(fp, exceptSessionKey) {
        for (const b of this.bySession.values()) {
            if (b.consumed || b.invalidatedReason)
                continue;
            if (exceptSessionKey && b.sessionKey === exceptSessionKey)
                continue;
            if (stagedFingerprintKey(b) === fp)
                return b;
        }
        return null;
    }
    putPending(binding, opts) {
        if (opts?.inboundGeneration != null &&
            !this.canCommitMessageReceived(binding.sessionKey, opts.inboundGeneration, opts.abortSignal)) {
            return false;
        }
        const fp = stagedFingerprintKey(binding);
        const dup = this.findDuplicateStagedFingerprint(fp, binding.sessionKey);
        if (dup) {
            return false;
        }
        this.invalidateSession(binding.sessionKey, "replaced");
        this.bySession.set(binding.sessionKey, binding);
        this.byCapability.set(binding.capabilityId, binding);
        return true;
    }
    getRaw(sessionKey) {
        return this.bySession.get(sessionKey) ?? null;
    }
    /** Pending or instruction_observed (awaiting claim). */
    getPending(sessionKey, nowMs = Date.now()) {
        const b = this.bySession.get(sessionKey);
        if (!b || !AWAITING_CLAIM.has(b.lifecycle))
            return null;
        if (b.consumed || b.invalidatedReason)
            return null;
        if (b.expiresAtMs < nowMs) {
            this.invalidateSession(sessionKey, "expiry");
            return null;
        }
        return b;
    }
    getActiveForSession(sessionKey, nowMs = Date.now()) {
        const b = this.bySession.get(sessionKey);
        if (!b)
            return null;
        if (b.consumed || b.lifecycle === "consumed" || b.invalidatedReason) {
            return null;
        }
        if (AWAITING_CLAIM.has(b.lifecycle))
            return null;
        if (b.expiresAtMs < nowMs) {
            this.invalidateSession(sessionKey, "expiry");
            return null;
        }
        return b;
    }
    observeInstructionMessage(sessionKey, input, nowMs = Date.now(), opts) {
        if (opts?.inboundGeneration != null &&
            !this.canCommitMessageReceived(sessionKey, opts.inboundGeneration, opts.abortSignal)) {
            return { ok: false, reason: "stale_or_aborted_inbound_generation" };
        }
        const b = this.getPending(sessionKey, nowMs);
        if (!b) {
            return { ok: false, reason: "no_pending" };
        }
        if (b.instructionObserved || b.lifecycle === "instruction_observed") {
            this.invalidateSession(sessionKey, "intervening_second_text_message");
            return { ok: false, reason: "already_instruction_observed" };
        }
        if (input.messageId === b.fileMessageId) {
            return { ok: false, reason: "same_as_file_message" };
        }
        if (input.accountId !== b.accountId) {
            this.invalidateSession(sessionKey, "account_mismatch");
            return { ok: false, reason: "account_mismatch" };
        }
        if (input.peerId !== b.peerId) {
            this.invalidateSession(sessionKey, "peer_mismatch");
            return { ok: false, reason: "peer_mismatch" };
        }
        if (input.senderId !== b.senderId) {
            this.invalidateSession(sessionKey, "sender_mismatch");
            return { ok: false, reason: "sender_mismatch" };
        }
        b.instructionObserved = true;
        b.instructionObservedAtMs = nowMs;
        b.instructionMessageId = input.messageId;
        b.lifecycle = "instruction_observed";
        return { ok: true, binding: b };
    }
    tryClaim(sessionKey, instructionRunId, nowMs = Date.now(), opts) {
        const existing = this.bySession.get(sessionKey);
        if (existing &&
            !AWAITING_CLAIM.has(existing.lifecycle) &&
            !existing.consumed &&
            existing.instructionRunId === instructionRunId) {
            return { ok: true, binding: existing };
        }
        if (existing &&
            !AWAITING_CLAIM.has(existing.lifecycle) &&
            existing.instructionRunId &&
            existing.instructionRunId !== instructionRunId) {
            return { ok: false, reason: "already_claimed_by_other_run" };
        }
        const b = this.getPending(sessionKey, nowMs);
        if (!b) {
            return { ok: false, reason: "no_pending" };
        }
        if (!b.instructionObserved) {
            return { ok: false, reason: "instruction_not_observed" };
        }
        if (b.instructionRunId) {
            return { ok: false, reason: "claim_race_lost" };
        }
        if (opts?.late) {
            if (b.lateClaimAttempts >= MAX_LATE_CLAIM_ATTEMPTS) {
                return { ok: false, reason: "late_claim_exhausted" };
            }
            b.lateClaimAttempts += 1;
        }
        b.claimEpoch += 1;
        b.instructionRunId = instructionRunId;
        b.lifecycle = "claimed";
        return { ok: true, binding: b };
    }
    /**
     * Atomically reserve or confirm a content digest after first SHA-256 pin.
     * Same capability may re-confirm; any other live/result reservation fails closed.
     */
    reserveContentDigest(binding, digest, nowMs = Date.now()) {
        const d = digest.trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(d)) {
            return { ok: false, reason: "content_digest_malformed" };
        }
        this.evictExpiredContentFingerprints(nowMs);
        const existing = this.contentByDigest.get(d);
        if (existing) {
            if (existing.expiresAtMs < nowMs) {
                this.contentByDigest.delete(d);
            }
            else if (existing.capabilityId === binding.capabilityId) {
                existing.expiresAtMs = Math.max(existing.expiresAtMs, binding.expiresAtMs);
                existing.sessionKey = binding.sessionKey;
                existing.agentId = binding.agentId;
                if (existing.status === "result" && !binding.consumed) {
                    existing.status = "reserved";
                }
                return { ok: true };
            }
            else {
                return { ok: false, reason: "duplicate_content_digest" };
            }
        }
        if (this.contentByDigest.size >= MAX_CONTENT_FINGERPRINTS) {
            this.evictExpiredContentFingerprints(nowMs);
            if (this.contentByDigest.size >= MAX_CONTENT_FINGERPRINTS) {
                // Drop oldest result entries first, then refuse if still full of live reservations.
                const victims = [...this.contentByDigest.entries()]
                    .filter(([, e]) => e.status === "result")
                    .sort((a, b) => a[1].expiresAtMs - b[1].expiresAtMs);
                for (const [key] of victims) {
                    this.contentByDigest.delete(key);
                    if (this.contentByDigest.size < MAX_CONTENT_FINGERPRINTS)
                        break;
                }
                if (this.contentByDigest.size >= MAX_CONTENT_FINGERPRINTS) {
                    return { ok: false, reason: "content_fingerprint_table_full" };
                }
            }
        }
        this.contentByDigest.set(d, {
            digest: d,
            capabilityId: binding.capabilityId,
            sessionKey: binding.sessionKey,
            agentId: binding.agentId,
            expiresAtMs: Math.max(binding.expiresAtMs, nowMs + PENDING_TTL_MS),
            status: "reserved",
        });
        return { ok: true };
    }
    markContentDigestResult(binding, nowMs = Date.now()) {
        const d = binding.sha256?.trim().toLowerCase();
        if (!d || !/^[0-9a-f]{64}$/.test(d))
            return;
        const existing = this.contentByDigest.get(d);
        if (!existing || existing.capabilityId !== binding.capabilityId)
            return;
        existing.status = "result";
        existing.expiresAtMs = Math.max(existing.expiresAtMs, nowMs + PENDING_TTL_MS);
    }
    evictExpiredContentFingerprints(nowMs) {
        for (const [key, e] of this.contentByDigest) {
            if (e.expiresAtMs < nowMs)
                this.contentByDigest.delete(key);
        }
    }
    consume(sessionKey, reason = "reconciled") {
        const b = this.bySession.get(sessionKey);
        if (!b || b.consumed || b.invalidatedReason)
            return null;
        b.lifecycle = "consumed";
        b.consumed = true;
        b.invalidatedReason = reason;
        this.markContentDigestResult(b);
        this.bySession.delete(sessionKey);
        this.byCapability.delete(b.capabilityId);
        return b;
    }
    invalidateSession(sessionKey, reason) {
        const b = this.bySession.get(sessionKey);
        if (!b)
            return;
        b.invalidatedReason = reason;
        b.lifecycle = "consumed";
        b.consumed = true;
        this.markContentDigestResult(b);
        this.bySession.delete(sessionKey);
        this.byCapability.delete(b.capabilityId);
    }
    onSessionReset(sessionKey) {
        this.invalidateSession(sessionKey, "session_reset");
    }
    onRunEnd(_runId) {
        /* no-op — multi-step tools share one claimed run */
    }
}
export const globalCapabilityStore = new CapabilityStore();
