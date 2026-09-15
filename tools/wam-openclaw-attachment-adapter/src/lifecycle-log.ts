/**
 * Metadata-only lifecycle logging for attachment sequence binding.
 * Never log paths, file contents, customer data, capability IDs, or full fingerprints.
 */

export type AttachmentLifecycleLogEvent =
  | "pending"
  | "instruction_observed"
  | "late_claim_success"
  | "wait_timeout"
  | "invalidated"
  | "consumed";

export type LifecycleLogger = {
  info?: (m: string) => void;
  warn?: (m: string) => void;
};

/** Short non-reversible session tag for correlation (not a secret, not a capability id). */
export function sessionTag(sessionKey: string | null | undefined): string {
  if (!sessionKey?.trim()) return "none";
  const s = sessionKey.trim();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `s${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function logAttachmentLifecycle(
  logger: LifecycleLogger | undefined,
  event: AttachmentLifecycleLogEvent,
  meta?: { reason?: string; sessionKey?: string | null },
): void {
  const tag = sessionTag(meta?.sessionKey);
  const reason = meta?.reason ? ` reason=${meta.reason}` : "";
  const line = `[wam-attachment-adapter] lifecycle=${event} session=${tag}${reason}`;
  if (
    event === "wait_timeout" ||
    event === "invalidated" ||
    event === "consumed"
  ) {
    logger?.warn?.(line);
  } else {
    logger?.info?.(line);
  }
}
