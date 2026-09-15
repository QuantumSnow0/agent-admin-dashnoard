/**
 * Read-only live-hook preflight helpers for v0.1.2 two-message design.
 * Scalar rule: non-empty string or finite number for identity fields.
 * Media flags are booleans only (never paths).
 */
export declare const LIVE_HOOK_PREFLIGHT_VERSION: "2026.7.1-2";
export declare const LIVE_HOOK_NAMES: readonly ["message_received", "before_prompt_build", "before_tool_call"];
export type LiveHookName = (typeof LIVE_HOOK_NAMES)[number];
/** Identity scalars for file-message capture (message_received). */
export declare const FILE_CAPTURE_IDENTITY_FIELDS: readonly ["messageId", "sessionKey", "accountId", "peerId", "senderId"];
/** Identity scalars for instruction claim hooks. */
export declare const CLAIM_TURN_IDENTITY_FIELDS: readonly ["sessionKey", "peerId", "runId", "messageId"];
export declare const MEDIA_FLAG_FIELDS: readonly ["qualifying_media_present", "staged_media_path_present", "media_staging_pending"];
export type FileCaptureField = (typeof FILE_CAPTURE_IDENTITY_FIELDS)[number];
export type ClaimTurnField = (typeof CLAIM_TURN_IDENTITY_FIELDS)[number];
export type MediaFlagField = (typeof MEDIA_FLAG_FIELDS)[number];
export declare function isScalarIdentityValue(value: unknown): boolean;
export type HookPresenceSnapshot = {
    hook: LiveHookName;
    identityPresent: Record<string, boolean>;
    mediaFlags: Record<MediaFlagField, boolean>;
    presentNames: string[];
    absentNames: string[];
};
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
 * - message_received (file): all file capture identity fields + staged path present
 *   (and not media_staging_pending)
 * - before_prompt_build / before_tool_call: sessionKey, peerId, runId scalar-present
 * Documented absence is not a PASS.
 */
export declare function evaluatePreflightPass(state: LiveHookPreflightState): {
    pass: boolean;
    reason: string;
    blockingAbsent: string[];
};
export type LiveHookPreflightApi = {
    logger?: {
        info?: (m: string) => void;
        warn?: (m: string) => void;
    };
    on?: (hook: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown) => void;
};
export declare function registerLiveHookPreflight(api: LiveHookPreflightApi, state?: LiveHookPreflightState): LiveHookPreflightState;
export declare function summarizePreflight(state: LiveHookPreflightState): {
    openclawTarget: "2026.7.1-2";
    hooksFired: {
        message_received: number;
        before_prompt_build: number;
        before_tool_call: number;
    };
    verdict: {
        pass: boolean;
        reason: string;
        blockingAbsent: string[];
    };
};
