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
export const LIVE_HOOK_PREFLIGHT_TARGET = "2026.7.1-2";
export const LIVE_HOOK_PREFLIGHT_PACKAGE_VERSION = "0.1.2";
export const LIVE_HOOK_NAMES = [
    "message_received",
    "before_prompt_build",
    "before_tool_call",
];
/** Identity scalars for file-message capture (message_received). */
export const FILE_CAPTURE_IDENTITY_FIELDS = [
    "messageId",
    "sessionKey",
    "accountId",
    "peerId",
    "senderId",
];
/** Identity scalars for instruction claim hooks. */
export const CLAIM_TURN_IDENTITY_FIELDS = [
    "sessionKey",
    "peerId",
    "runId",
];
export const MEDIA_FLAG_FIELDS = [
    "qualifying_media_present",
    "staged_media_path_present",
    "media_staging_pending",
];
/** @deprecated use FILE_CAPTURE / CLAIM_TURN — kept for log tests */
export const CAPTURE_IDENTITY_FIELDS = [
    ...FILE_CAPTURE_IDENTITY_FIELDS,
    ...CLAIM_TURN_IDENTITY_FIELDS,
];
export function isScalarIdentityValue(value) {
    if (typeof value === "string")
        return value.trim().length > 0;
    if (typeof value === "number")
        return Number.isFinite(value);
    return false;
}
function readPath(root, path) {
    let cur = root;
    for (const key of path) {
        if (!cur || typeof cur !== "object")
            return undefined;
        cur = cur[key];
    }
    return cur;
}
const IDENTITY_CANDIDATES = {
    messageId: [
        ["event", "messageId"],
        ["event", "message_id"],
        ["ctx", "messageId"],
    ],
    sessionKey: [
        ["event", "sessionKey"],
        ["ctx", "sessionKey"],
        ["ctx", "deliveryContext", "sessionKey"],
    ],
    accountId: [
        ["event", "accountId"],
        ["ctx", "accountId"],
        ["ctx", "deliveryContext", "accountId"],
    ],
    peerId: [
        ["event", "peerId"],
        ["event", "chatId"],
        ["ctx", "peerId"],
        ["ctx", "chatId"],
        ["ctx", "conversationId"],
    ],
    senderId: [
        ["event", "senderId"],
        ["ctx", "senderId"],
        ["ctx", "requesterSenderId"],
    ],
    runId: [
        ["event", "runId"],
        ["ctx", "runId"],
    ],
};
function scanMediaFlags(event) {
    const media = Array.isArray(event.media) ? event.media : [];
    let qualifying = false;
    let stagedPath = false;
    for (const item of media) {
        if (!item || typeof item !== "object")
            continue;
        const row = item;
        const p = row.path;
        const mime = String(row.contentType ?? row.mimeType ?? "").toLowerCase();
        const hasPath = typeof p === "string" && p.trim().length > 0;
        if (hasPath)
            stagedPath = true;
        if (hasPath &&
            (mime.includes("csv") ||
                mime.includes("sheet") ||
                mime.includes("excel") ||
                String(p).toLowerCase().endsWith(".csv") ||
                String(p).toLowerCase().endsWith(".xlsx"))) {
            qualifying = true;
        }
    }
    return {
        qualifying_media_present: qualifying,
        staged_media_path_present: stagedPath,
        media_staging_pending: Boolean(event.mediaStagingPending),
    };
}
export function scanHookFieldPresence(hook, event, ctx) {
    const roots = { event, ctx };
    const keys = hook === "message_received"
        ? [...FILE_CAPTURE_IDENTITY_FIELDS]
        : [...CLAIM_TURN_IDENTITY_FIELDS];
    const identityPresent = {};
    for (const key of keys) {
        let found = false;
        for (const path of IDENTITY_CANDIDATES[key] ?? []) {
            if (isScalarIdentityValue(readPath(roots, path))) {
                found = true;
                break;
            }
        }
        identityPresent[key] = found;
    }
    const mediaFlags = scanMediaFlags(event);
    const presentNames = [
        ...keys.filter((k) => identityPresent[k]),
        ...(hook === "message_received"
            ? MEDIA_FLAG_FIELDS.filter((k) => mediaFlags[k])
            : []),
    ];
    const absentNames = [
        ...keys.filter((k) => !identityPresent[k]),
        ...(hook === "message_received"
            ? MEDIA_FLAG_FIELDS.filter((k) => !mediaFlags[k])
            : []),
    ];
    return {
        hook,
        identityPresent,
        mediaFlags,
        presentNames,
        absentNames,
    };
}
export function formatPresenceLogLine(snapshot) {
    const present = snapshot.presentNames.join(",") || "(none)";
    const absent = snapshot.absentNames.join(",") || "(none)";
    return `[wam-live-hook-preflight] hook=${snapshot.hook} present_fields=${present} absent_fields=${absent}`;
}
export function createLiveHookPreflightState() {
    return {
        snapshots: {},
        qualifyingFileSnapshot: null,
        counts: {
            message_received: 0,
            before_prompt_build: 0,
            before_tool_call: 0,
        },
    };
}
/**
 * PASS for two-message design:
 * - message_received: file capture identity + qualifying staged path; not staging
 * - before_prompt_build / before_tool_call: sessionKey, peerId, runId
 * Documented absence is not a PASS.
 */
export function evaluatePreflightPass(state) {
    const blockingAbsent = [];
    const fileSnap = state.qualifyingFileSnapshot ?? state.snapshots.message_received;
    if (!fileSnap || state.counts.message_received < 1) {
        blockingAbsent.push("message_received:hook_never_fired");
    }
    else {
        for (const f of FILE_CAPTURE_IDENTITY_FIELDS) {
            if (!fileSnap.identityPresent[f]) {
                blockingAbsent.push(`message_received:${f}`);
            }
        }
        if (!fileSnap.mediaFlags.staged_media_path_present) {
            blockingAbsent.push("message_received:staged_media_path_present");
        }
        if (!fileSnap.mediaFlags.qualifying_media_present) {
            blockingAbsent.push("message_received:qualifying_media_present");
        }
        if (fileSnap.mediaFlags.media_staging_pending) {
            blockingAbsent.push("message_received:media_still_staging");
        }
    }
    for (const hook of ["before_prompt_build", "before_tool_call"]) {
        const snap = state.snapshots[hook];
        if (!snap || state.counts[hook] < 1) {
            blockingAbsent.push(`${hook}:hook_never_fired`);
            continue;
        }
        for (const f of CLAIM_TURN_IDENTITY_FIELDS) {
            if (!snap.identityPresent[f])
                blockingAbsent.push(`${hook}:${f}`);
        }
    }
    const pass = blockingAbsent.length === 0;
    return {
        pass,
        reason: pass
            ? "two_message_preflight_pass"
            : `missing_required_fields:${blockingAbsent.join("|")}`,
        hooksFired: { ...state.counts },
        blockingAbsent,
    };
}
export function registerLiveHookPreflight(api, state = createLiveHookPreflightState()) {
    api.logger?.info?.(`[wam-live-hook-preflight] registering read-only presence probes target=${LIVE_HOOK_PREFLIGHT_TARGET} package=${LIVE_HOOK_PREFLIGHT_PACKAGE_VERSION}`);
    for (const hook of LIVE_HOOK_NAMES) {
        api.on?.(hook, (event, ctx) => {
            const snapshot = scanHookFieldPresence(hook, (event ?? {}), (ctx ?? {}));
            state.counts[hook] += 1;
            state.snapshots[hook] = snapshot;
            if (hook === "message_received" &&
                snapshot.mediaFlags.qualifying_media_present &&
                snapshot.mediaFlags.staged_media_path_present &&
                !snapshot.mediaFlags.media_staging_pending) {
                if (!state.qualifyingFileSnapshot) {
                    state.qualifyingFileSnapshot = snapshot;
                }
            }
            api.logger?.info?.(formatPresenceLogLine(snapshot));
            const verdict = evaluatePreflightPass(state);
            api.logger?.info?.(`[wam-live-hook-preflight] verdict=${verdict.pass ? "PASS" : "NO-GO"} reason=${verdict.reason}`);
            if (hook === "before_prompt_build") {
                return {};
            }
            return undefined;
        });
    }
    return state;
}
export function isPreflightExplicitlyEnabled(env = process.env) {
    const raw = (env.WAM_LIVE_HOOK_PREFLIGHT_ENABLED ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
}
