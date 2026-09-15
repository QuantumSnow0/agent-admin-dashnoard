/**
 * Read-only presence scanner for OpenClaw live-hook preflight v0.1.1.
 *
 * Matches adapter v0.1.2 two-message design:
 * - message_received (file): capture identity + media flags
 * - before_prompt_build / before_tool_call (instruction): sessionKey, peerId, runId
 *
 * Scalar identity rule: non-empty string or finite number.
 * Logs field names / presence only — never values, paths, or message content.
 */
export declare const LIVE_HOOK_PREFLIGHT_TARGET: "2026.7.1-2";
export declare const LIVE_HOOK_PREFLIGHT_PACKAGE_VERSION: "0.1.2";
export declare const LIVE_HOOK_NAMES: readonly ["message_received", "before_prompt_build", "before_tool_call"];
export type LiveHookName = (typeof LIVE_HOOK_NAMES)[number];
/** Identity scalars for file-message capture (message_received). */
export declare const FILE_CAPTURE_IDENTITY_FIELDS: readonly ["messageId", "sessionKey", "accountId", "peerId", "senderId"];
/** Identity scalars for instruction claim hooks. */
export declare const CLAIM_TURN_IDENTITY_FIELDS: readonly ["sessionKey", "peerId", "runId"];
export declare const MEDIA_FLAG_FIELDS: readonly ["qualifying_media_present", "staged_media_path_present", "media_staging_pending"];
export type FileCaptureField = (typeof FILE_CAPTURE_IDENTITY_FIELDS)[number];
export type ClaimTurnField = (typeof CLAIM_TURN_IDENTITY_FIELDS)[number];
export type MediaFlagField = (typeof MEDIA_FLAG_FIELDS)[number];
/** @deprecated use FILE_CAPTURE / CLAIM_TURN — kept for log tests */
export declare const CAPTURE_IDENTITY_FIELDS: readonly ["messageId", "sessionKey", "accountId", "peerId", "senderId", "sessionKey", "peerId", "runId"];
export type HookPresenceSnapshot = {
    hook: LiveHookName;
    identityPresent: Record<string, boolean>;
    mediaFlags: Record<MediaFlagField, boolean>;
    presentNames: string[];
    absentNames: string[];
};
export type PreflightVerdict = {
    pass: boolean;
    reason: string;
    hooksFired: Record<LiveHookName, number>;
    blockingAbsent: string[];
};
export declare function isScalarIdentityValue(value: unknown): boolean;
export declare function scanHookFieldPresence(hook: LiveHookName, event: Record<string, unknown>, ctx: Record<string, unknown>): HookPresenceSnapshot;
export declare function formatPresenceLogLine(snapshot: HookPresenceSnapshot): string;
export type LiveHookPreflightState = {
    snapshots: Partial<Record<LiveHookName, HookPresenceSnapshot>>;
    /** Preserved qualifying file message_received snapshot (not overwritten by text). */
    qualifyingFileSnapshot: HookPresenceSnapshot | null;
    counts: Record<LiveHookName, number>;
};
export declare function createLiveHookPreflightState(): LiveHookPreflightState;
/**
 * PASS for two-message design:
 * - message_received: file capture identity + qualifying staged path; not staging
 * - before_prompt_build / before_tool_call: sessionKey, peerId, runId
 * Documented absence is not a PASS.
 */
export declare function evaluatePreflightPass(state: LiveHookPreflightState): PreflightVerdict;
export type LiveHookPreflightLogger = {
    info?: (message: string) => void;
    warn?: (message: string) => void;
};
export type LiveHookPreflightApi = {
    logger?: LiveHookPreflightLogger;
    on?: (hook: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown, opts?: Record<string, unknown>) => void;
};
export declare function registerLiveHookPreflight(api: LiveHookPreflightApi, state?: LiveHookPreflightState): LiveHookPreflightState;
export declare function isPreflightExplicitlyEnabled(env?: NodeJS.ProcessEnv): boolean;
