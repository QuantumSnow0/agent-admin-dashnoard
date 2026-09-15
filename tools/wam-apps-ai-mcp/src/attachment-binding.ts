/**
 * Attachment / stale-path isolation for Phase 1A.8 document tools.
 *
 * MCP cannot cryptographically verify that an attachment_path belongs to the
 * *current* Telegram message/update unless OpenClaw injects that binding into
 * the tool call. Claiming otherwise would be dishonest → DEPLOYMENT_BLOCKER.
 */

export const ATTACHMENT_BINDING_STATUS = {
  /** Operator must confirm OpenClaw only injects current-message MediaPath. */
  deployment_blocker:
    "DEPLOYMENT_BLOCKER: OpenClaw tool context does not cryptographically bind attachment_path to the current Telegram message/update. MCP requires an explicit attachment_path on every call and will not invent or reuse a previous path. Before production use, confirm OpenClaw injects MediaPath only for the current message and clears it on /new.",
} as const;

export type PriorReuseGate = {
  actorId: string;
  actorRole: string;
  sessionOrChannelId: string | null;
  peerRef: string | null;
  contentFingerprint: string;
  allowPriorFingerprintReuse: boolean;
  sessionReset: boolean;
};

type FingerprintEntry = {
  at: number;
  correlationId: string;
  actorId: string;
  sessionOrChannelId: string | null;
  peerRef: string | null;
  summary: Record<string, unknown>;
};

const REUSE_TTL_MS = 600_000;

/** In-memory prior-reconcile cache — never used to invent attachment paths. */
const priorByFingerprint = new Map<string, FingerprintEntry>();

function cacheKey(actorId: string, fingerprint: string): string {
  return `${actorId}::${fingerprint}`;
}

export function invalidateAttachmentStateForActor(actorId: string): void {
  for (const k of [...priorByFingerprint.keys()]) {
    if (k.startsWith(`${actorId}::`)) priorByFingerprint.delete(k);
  }
}

export function rememberFingerprintReconcile(
  gate: Omit<PriorReuseGate, "allowPriorFingerprintReuse" | "sessionReset">,
  correlationId: string,
  summary: Record<string, unknown>,
): void {
  priorByFingerprint.set(cacheKey(gate.actorId, gate.contentFingerprint), {
    at: Date.now(),
    correlationId,
    actorId: gate.actorId,
    sessionOrChannelId: gate.sessionOrChannelId,
    peerRef: gate.peerRef,
    summary,
  });
}

/**
 * Explicit prior-document reuse only when caller opts in AND identity/session/
 * peer/fingerprint/expiry all match. Never returns a path; only a prior summary.
 */
export function lookupExplicitPriorReuse(gate: PriorReuseGate): {
  hit: false;
  reason?: string;
} | {
  hit: true;
  correlationId: string;
  summary: Record<string, unknown>;
} {
  if (gate.sessionReset) {
    invalidateAttachmentStateForActor(gate.actorId);
    return { hit: false, reason: "session_reset" };
  }
  if (!gate.allowPriorFingerprintReuse) {
    return { hit: false, reason: "reuse_not_requested" };
  }
  const entry = priorByFingerprint.get(cacheKey(gate.actorId, gate.contentFingerprint));
  if (!entry) return { hit: false, reason: "no_prior" };
  if (Date.now() - entry.at > REUSE_TTL_MS) {
    priorByFingerprint.delete(cacheKey(gate.actorId, gate.contentFingerprint));
    return { hit: false, reason: "expired" };
  }
  if (entry.actorId !== gate.actorId) return { hit: false, reason: "actor_mismatch" };
  if (entry.sessionOrChannelId !== gate.sessionOrChannelId) {
    return { hit: false, reason: "session_mismatch" };
  }
  if ((entry.peerRef ?? null) !== (gate.peerRef ?? null)) {
    return { hit: false, reason: "peer_mismatch" };
  }
  return { hit: true, correlationId: entry.correlationId, summary: entry.summary };
}

/** Test helper */
export function clearAttachmentReuseCache(): void {
  priorByFingerprint.clear();
}
