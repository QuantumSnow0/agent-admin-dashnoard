/**
 * Metadata-only lifecycle logging for attachment sequence binding.
 * Never log paths, file contents, customer data, capability IDs, or full fingerprints.
 */
export type AttachmentLifecycleLogEvent = "pending" | "instruction_observed" | "late_claim_success" | "wait_timeout" | "invalidated" | "consumed";
export type LifecycleLogger = {
    info?: (m: string) => void;
    warn?: (m: string) => void;
};
/** Short non-reversible session tag for correlation (not a secret, not a capability id). */
export declare function sessionTag(sessionKey: string | null | undefined): string;
export declare function logAttachmentLifecycle(logger: LifecycleLogger | undefined, event: AttachmentLifecycleLogEvent, meta?: {
    reason?: string;
    sessionKey?: string | null;
}): void;
