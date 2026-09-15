import path from "node:path";
import { mintPendingBinding, stagedFingerprintKey, } from "./capability-mint.js";
import { assertSafeStagedAttachmentPath, } from "./path-safety.js";
const QUALIFYING_EXT = new Set([".csv", ".xlsx"]);
const QUALIFYING_MIME = new Set([
    "text/csv",
    "application/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
]);
export function isQualifyingAttachment(att) {
    const p = att.path?.trim();
    if (!p)
        return false;
    const ext = path.extname(p).toLowerCase();
    if (QUALIFYING_EXT.has(ext))
        return true;
    const mime = (att.mimeType ?? "").toLowerCase();
    return QUALIFYING_MIME.has(mime);
}
export function extractCaptureFields(event) {
    const meta = (event.metadata ?? event.providerUpdate ?? {});
    const messageId = str(event.messageId) ??
        str(event.message_id) ??
        str(meta.message_id) ??
        null;
    const accountId = str(event.accountId) ?? str(meta.accountId) ?? str(meta.account) ?? null;
    const peerId = str(event.peerId) ??
        str(event.chatId) ??
        str(meta.peerId) ??
        str(meta.peer) ??
        null;
    const senderId = str(event.senderId) ?? str(meta.senderId) ?? str(meta.sender) ?? null;
    const sessionKey = str(event.sessionKey) ?? str(meta.sessionKey) ?? null;
    const runId = str(event.runId) ?? str(meta.runId) ?? null;
    const updateId = str(event.update_id) ??
        str(event.updateId) ??
        str(meta.update_id) ??
        null;
    const mediaStagingPending = Boolean(event.mediaStagingPending);
    const media = Array.isArray(event.media) ? event.media : [];
    const attachments = [];
    media.forEach((m, index) => {
        if (!m || typeof m !== "object")
            return;
        const row = m;
        const p = str(row.path);
        if (!p)
            return;
        const mime = str(row.contentType) ?? str(row.mimeType);
        if (!isQualifyingAttachment({ path: p, mimeType: mime }))
            return;
        attachments.push({
            path: p,
            mimeType: mime,
            sizeBytes: typeof row.size === "number" ? row.size : null,
            index,
            fileUniqueId: str(row.fileUniqueId) ??
                str(row.file_unique_id) ??
                str(meta.file_unique_id) ??
                null,
        });
    });
    const missingTrustedFields = [];
    if (!messageId)
        missingTrustedFields.push("message_id");
    if (!accountId)
        missingTrustedFields.push("account_id");
    if (!peerId)
        missingTrustedFields.push("peer_id");
    if (!senderId)
        missingTrustedFields.push("sender_id");
    if (!sessionKey)
        missingTrustedFields.push("session_key");
    if (attachments.length === 0)
        missingTrustedFields.push("staged_media_path");
    return {
        messageId,
        accountId,
        peerId,
        senderId,
        sessionKey,
        runId,
        updateId,
        mediaStagingPending,
        qualifyingMediaPresent: attachments.length > 0,
        stagedMediaPathPresent: attachments.some((a) => Boolean(a.path)),
        attachments,
        missingTrustedFields,
    };
}
function str(v) {
    if (typeof v === "string" && v.trim())
        return v.trim();
    if (typeof v === "number" && Number.isFinite(v))
        return String(v);
    return null;
}
/**
 * File-message capture → pending (v0.1.3).
 * Does not require runId, update_id, or file_unique_id.
 * Instruction observation is handled by processMessageReceivedSequence.
 */
export function capturePendingAttachment(store, event, opts) {
    if (!opts.agentId?.trim()) {
        return {
            status: "error",
            reason: "missing_required_fields",
            missingTrustedFields: ["agent_id"],
        };
    }
    const extracted = extractCaptureFields(event);
    if (extracted.mediaStagingPending) {
        return { status: "ignored", reason: "media_staging_pending" };
    }
    if (extracted.attachments.length === 0) {
        return { status: "ignored", reason: "no_qualifying_attachment" };
    }
    if (extracted.missingTrustedFields.length > 0) {
        return {
            status: "error",
            reason: "missing_required_fields",
            missingTrustedFields: extracted.missingTrustedFields,
        };
    }
    const idx = typeof opts.attachmentIndex === "number"
        ? opts.attachmentIndex
        : extracted.attachments[0].index;
    const att = extracted.attachments.find((a) => a.index === idx) ??
        extracted.attachments[0];
    let safe;
    try {
        safe = assertSafeStagedAttachmentPath(att.path, opts.attachmentRoots);
    }
    catch (err) {
        const reason = err instanceof Error && "reason" in err
            ? String(err.reason)
            : "path_rejected";
        return { status: "error", reason };
    }
    let digest = "";
    // v0.2.0: do not read/hash file contents inside message_received.
    // Pin lstat identity (size/inode/device/mtime); sha256 deferred to tool revalidate.
    let mtimeMs;
    try {
        const again = assertSafeStagedAttachmentPath(att.path, opts.attachmentRoots);
        if (String(again.inode) !== String(safe.inode) ||
            String(again.deviceId) !== String(safe.deviceId) ||
            again.sizeBytes !== safe.sizeBytes ||
            again.mtimeMs !== safe.mtimeMs) {
            return { status: "error", reason: "toctou_identity_changed" };
        }
        mtimeMs = again.mtimeMs;
    }
    catch {
        return { status: "error", reason: "toctou_revalidate_failed" };
    }
    const displayFileName = path.basename(safe.absolutePath);
    const input = {
        fileMessageId: extracted.messageId,
        accountId: extracted.accountId,
        peerId: extracted.peerId,
        senderId: extracted.senderId,
        agentId: opts.agentId.trim(),
        sessionKey: extracted.sessionKey,
        sessionGeneration: opts.sessionGeneration ?? null,
        attachmentIndex: att.index,
        fileUniqueId: att.fileUniqueId ?? null,
        canonicalPath: safe.absolutePath,
        displayFileName,
        mimeType: att.mimeType,
        sizeBytes: safe.sizeBytes,
        deviceId: safe.deviceId,
        inode: safe.inode,
        nlink: safe.nlink,
        mtimeMs,
        sha256: digest,
    };
    const binding = mintPendingBinding(input, opts.nowMs);
    const fp = stagedFingerprintKey(binding);
    if (store.findDuplicateStagedFingerprint(fp, binding.sessionKey)) {
        return { status: "error", reason: "duplicate_staged_fingerprint" };
    }
    const committed = store.putPending(binding, {
        inboundGeneration: opts.inboundGeneration,
        abortSignal: opts.abortSignal,
    });
    if (!committed) {
        if (store.findDuplicateStagedFingerprint(fp)) {
            return { status: "error", reason: "duplicate_staged_fingerprint" };
        }
        return { status: "error", reason: "stale_or_aborted_inbound_generation" };
    }
    return {
        status: "pending",
        capabilityId: binding.capabilityId,
        attachmentIndex: att.index,
        lifecycle: "pending",
    };
}
/** @deprecated Use capturePendingAttachment — kept for test migration aliases. */
export function captureStagedAttachment(store, event, opts) {
    return capturePendingAttachment(store, event, {
        ...opts,
        attachmentRoots: opts.attachmentRoots ?? [],
    });
}
export function buildFileAckPromptHint() {
    return buildPendingRacePromptHint();
}
/**
 * Neutral guidance while a spreadsheet may be pending and instruction_observed
 * may still be racing the prompt/tool catalogue (stock OpenClaw live order).
 */
export function buildPendingRacePromptHint() {
    return [
        "A prior spreadsheet attachment may be pending for this session.",
        "If the current user message requests processing that spreadsheet, call inspect_current_business_document (then parse/reconcile as needed).",
        "The pathless wrappers validate the file→instruction sequence or fail closed.",
        "Never invent or expose a filesystem path. Do not call wam.business.documents.* path tools.",
        "If the current message is only the file with no processing instruction, acknowledge receipt briefly and wait.",
    ].join(" ");
}
export function buildClaimedPromptHint() {
    return [
        "A pending spreadsheet attachment is bound to this instruction turn.",
        "Use inspect_current_business_document, then parse_current_document_customers, then reconcile_current_document_customers.",
        "Do not pass filesystem paths. Do not use wam.business.documents.* path tools.",
    ].join(" ");
}
export function buildNoAttachmentPromptHint() {
    return [
        "No claimed spreadsheet attachment is bound for this turn.",
        "If the user wants document reconciliation, ask them to send a CSV/XLSX first, then send the instruction as the immediately following message.",
        "Do not invent filesystem paths. Do not call path-taking document tools.",
    ].join(" ");
}
/** @deprecated */
export function buildAttachmentPromptHint(hasActive) {
    return hasActive ? buildClaimedPromptHint() : buildNoAttachmentPromptHint();
}
