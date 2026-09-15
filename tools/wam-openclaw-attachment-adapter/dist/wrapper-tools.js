import { assertBindingMatchesTurn } from "./binding-checks.js";
import { bindingUsableForTools, resolveBindingForToolsAsync, } from "./handshake.js";
import { advanceLifecycle, assertToolAllowedAtLifecycle, lifecycleTargetForTool, } from "./lifecycle.js";
import { logAttachmentLifecycle } from "./lifecycle-log.js";
import { RAW_DOCUMENT_MCP_PREFIX } from "./types.js";
const WRAPPER_TO_MCP = {
    inspect_current_business_document: "inspect_business_document",
    parse_current_document_customers: "parse_document_customers",
    reconcile_current_document_customers: "reconcile_document_customers",
};
export async function executeWrapperTool(opts) {
    const { tool, store, bridge, turn } = opts;
    const resolved = await resolveBindingForToolsAsync(store, turn, {
        maxWaitMs: opts.observeWaitMs,
        pollMs: opts.observePollMs,
        logger: opts.logger,
        signal: opts.signal,
    });
    if (!resolved.ok) {
        const category = resolved.reason;
        return {
            ok: false,
            denied: true,
            userMessage: category === "wait_timeout" || category === "instruction_not_observed"
                ? "No instruction was observed for the pending spreadsheet in time. Re-send the file, then send your processing instruction as the next message."
                : category === "no_pending"
                    ? "No claimed spreadsheet for this instruction. Send the CSV/XLSX first, then send your instruction as the immediately following message."
                    : "Attachment context no longer matches this conversation. Please re-send the file, then your instruction.",
            error: {
                category,
                message: category,
            },
        };
    }
    const binding = resolved.binding;
    const match = assertBindingMatchesTurn(binding, turn, Date.now(), store);
    if (!match.ok) {
        store.invalidateSession(turn.sessionKey, match.reason);
        logAttachmentLifecycle(opts.logger, "invalidated", {
            sessionKey: turn.sessionKey,
            reason: match.reason,
        });
        return denyMismatch(match.reason);
    }
    const life = assertToolAllowedAtLifecycle(binding, tool);
    if (!life.ok) {
        return {
            ok: false,
            denied: true,
            userMessage: life.reason === "must_inspect_before_parse"
                ? "Inspect the current document first, then parse, then reconcile."
                : life.reason === "must_parse_before_reconcile"
                    ? "Parse the current document customers before reconciling."
                    : life.reason === "still_pending"
                        ? "Attachment is still pending — send your instruction as the next message after the file."
                        : "Attachment lifecycle does not allow that step. Re-send the file and instruction.",
            error: { category: life.reason, message: life.reason },
        };
    }
    const mcpTool = WRAPPER_TO_MCP[tool];
    const safeArgs = { ...(opts.args ?? {}) };
    delete safeArgs.attachment_path;
    delete safeArgs.attachmentPath;
    delete safeArgs.path;
    const result = await bridge.callDocumentTool({
        tool: mcpTool,
        attachmentPath: binding.canonicalPath,
        args: safeArgs,
    });
    const post = assertBindingMatchesTurn(binding, turn, Date.now(), store);
    if (!post.ok) {
        store.invalidateSession(turn.sessionKey, post.reason);
        logAttachmentLifecycle(opts.logger, "invalidated", {
            sessionKey: turn.sessionKey,
            reason: post.reason,
        });
        return denyMismatch(post.reason);
    }
    if (!result.ok) {
        if (tool === "reconcile_current_document_customers") {
            store.consume(turn.sessionKey, "reconcile_terminal_failure");
            logAttachmentLifecycle(opts.logger, "consumed", {
                sessionKey: turn.sessionKey,
                reason: "reconcile_terminal_failure",
            });
        }
        return {
            ok: false,
            error: result.error ?? { category: "mcp_failure", message: "MCP call failed" },
            userMessage: "I could not process that attachment. You may retry inspect/parse, or re-send the file.",
        };
    }
    advanceLifecycle(binding, lifecycleTargetForTool(tool));
    if (tool === "reconcile_current_document_customers") {
        store.consume(turn.sessionKey, "reconciled");
        logAttachmentLifecycle(opts.logger, "consumed", {
            sessionKey: turn.sessionKey,
            reason: "reconciled",
        });
    }
    const safe = toSafeToolPayload(tool, binding, result.data);
    return { ok: true, data: safe };
}
/** @deprecated Prefer resolveBindingForToolsAsync at execute time. */
export function syncBindingForTools(store, turn) {
    return bindingUsableForTools(store, turn);
}
/** Safe metadata for the model — never paths or capability IDs. */
export function toSafeToolPayload(tool, binding, data) {
    const redacted = redactHostPaths(data);
    if (tool !== "inspect_current_business_document") {
        return redactCapabilityIds(redacted);
    }
    const meta = extractSafeDocumentMeta(binding, redacted);
    return redactCapabilityIds({
        document: meta,
        details: redacted,
    });
}
function extractSafeDocumentMeta(binding, data) {
    const row = data && typeof data === "object" ? data : {};
    const nested = row.document && typeof row.document === "object"
        ? row.document
        : row;
    const ext = binding.displayFileName.toLowerCase().endsWith(".xlsx")
        ? "xlsx"
        : binding.displayFileName.toLowerCase().endsWith(".csv")
            ? "csv"
            : (binding.mimeType ?? "unknown");
    return {
        filename: binding.displayFileName,
        type: ext,
        sheet_name: nested.sheet_name ?? nested.sheetName ?? nested.active_sheet ?? null,
        row_estimate: nested.row_estimate ??
            nested.rowEstimate ??
            nested.row_count ??
            nested.rowCount ??
            null,
        size_bytes: binding.sizeBytes,
    };
}
function redactCapabilityIds(data) {
    if (data == null)
        return data;
    const text = JSON.stringify(data);
    const redacted = text.replace(/wam-attcap-[A-Za-z0-9_-]+/g, "[REDACTED_CAPABILITY]");
    try {
        return JSON.parse(redacted);
    }
    catch {
        return { status: "success", note: "redacted" };
    }
}
function denyMismatch(reason) {
    return {
        ok: false,
        denied: true,
        userMessage: "Attachment context no longer matches this conversation. Please re-send the file, then your instruction.",
        error: { category: reason, message: reason },
    };
}
export function redactHostPaths(data) {
    if (data == null)
        return data;
    const text = JSON.stringify(data);
    const redacted = text
        .replace(/\/home\/[^"\\]+/g, "[REDACTED_PATH]")
        .replace(/\\\\home\\\\[^"\\]+/g, "[REDACTED_PATH]");
    try {
        return JSON.parse(redacted);
    }
    catch {
        return { status: "success", note: "redacted" };
    }
}
export function shouldBlockRawDocumentTool(toolName) {
    return toolName.startsWith(RAW_DOCUMENT_MCP_PREFIX);
}
