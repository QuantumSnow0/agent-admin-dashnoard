/**
 * Read-only live-hook preflight helpers for v0.1.2 two-message design.
 * Scalar rule: non-empty string or finite number for identity fields.
 * Media flags are booleans only (never paths).
 */
export const LIVE_HOOK_PREFLIGHT_VERSION = "2026.7.1-2";
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
    "messageId",
];
export const MEDIA_FLAG_FIELDS = [
    "qualifying_media_present",
    "staged_media_path_present",
    "media_staging_pending",
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
        ...MEDIA_FLAG_FIELDS.filter((k) => mediaFlags[k]),
    ];
    const absentNames = [
        ...keys.filter((k) => !identityPresent[k]),
        ...MEDIA_FLAG_FIELDS.filter((k) => !mediaFlags[k]),
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
 * - message_received (file): all file capture identity fields + staged path present
 *   (and not media_staging_pending)
 * - before_prompt_build / before_tool_call: sessionKey, peerId, runId scalar-present
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
    return {
        pass: blockingAbsent.length === 0,
        reason: blockingAbsent.length === 0
            ? "two_message_preflight_pass"
            : `missing_required_fields:${blockingAbsent.join("|")}`,
        blockingAbsent,
    };
}
export function registerLiveHookPreflight(api, state = createLiveHookPreflightState()) {
    for (const hook of LIVE_HOOK_NAMES) {
        api.on?.(hook, (event, ctx) => {
            const snapshot = scanHookFieldPresence(hook, (event ?? {}), (ctx ?? {}));
            state.counts[hook] += 1;
            state.snapshots[hook] = snapshot;
            // Preserve first qualifying file snapshot; do not let text-only overwrite PASS basis.
            if (hook === "message_received" &&
                snapshot.mediaFlags.qualifying_media_present &&
                snapshot.mediaFlags.staged_media_path_present &&
                !snapshot.mediaFlags.media_staging_pending) {
                if (!state.qualifyingFileSnapshot) {
                    state.qualifyingFileSnapshot = snapshot;
                }
            }
            api.logger?.info?.(formatPresenceLogLine(snapshot));
            if (hook === "before_prompt_build")
                return {};
            return undefined;
        });
    }
    return state;
}
export function summarizePreflight(state) {
    return {
        openclawTarget: LIVE_HOOK_PREFLIGHT_VERSION,
        hooksFired: { ...state.counts },
        verdict: evaluatePreflightPass(state),
    };
}
