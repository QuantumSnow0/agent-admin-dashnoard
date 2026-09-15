/**
 * OpenClaw plugin entry — host-side attachment capability adapter v0.2.2.
 *
 * Plugin-only sequence binding on stock OpenClaw 2026.7.1-2 (no core patch).
 * Wrappers are always catalogued when alsoAllow permits; execute waits briefly
 * for async instruction_observed then late-claims (live VPS race fix).
 */
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { globalCapabilityStore } from "./capability-store.js";
import { syncHandshakeForTurn } from "./handshake.js";
import { processMessageReceivedSequence } from "./message-sequence.js";
import { assertStdioMcpBridgeAvailable, createStdioMcpBridge, resolveStdioMcpBridgeConfigFromEnv, } from "./mcp-bridge.js";
import { resolveAttachmentRootsFromEnv } from "./path-safety.js";
import { assertOpenClawVersion, resolveOpenClawVersion, } from "./version-guard.js";
import { executeWrapperTool, shouldBlockRawDocumentTool, } from "./wrapper-tools.js";
import { WRAPPER_TOOL_NAMES } from "./types.js";
import { logAttachmentLifecycle } from "./lifecycle-log.js";
export function createAdapterRuntime(opts) {
    if (!opts.bridge || opts.bridge.kind !== "stdio") {
        throw new Error("production_bridge_required: createAdapterRuntime rejects mock/missing bridges");
    }
    const roots = opts.attachmentRoots ?? resolveAttachmentRootsFromEnv();
    if (!roots.length) {
        throw new Error("attachment_roots_required: set WAM_ATTACHMENT_ROOTS or WAM_AI_ATTACHMENT_ROOTS");
    }
    return {
        store: globalCapabilityStore,
        bridge: opts.bridge,
        openclawVersion: opts.openclawVersion ?? null,
        agentId: opts.agentId ?? "bonface-owner",
        attachmentRoots: roots,
        allowMockBridge: false,
    };
}
export function createTestAdapterRuntime(opts) {
    return {
        store: opts.store ?? globalCapabilityStore,
        bridge: opts.bridge,
        openclawVersion: opts.openclawVersion ?? null,
        agentId: opts.agentId ?? "bonface-owner",
        attachmentRoots: opts.attachmentRoots ?? ["/tmp/wam-test-roots"],
        allowMockBridge: true,
    };
}
export function turnFromCtx(event, ctx, agentId) {
    const delivery = ctx.deliveryContext;
    return {
        sessionKey: String(ctx.sessionKey ?? event.sessionKey ?? delivery?.sessionKey ?? ""),
        runId: str(ctx.runId ?? event.runId),
        messageId: str(ctx.messageId ?? event.messageId),
        accountId: str(ctx.accountId ?? event.accountId ?? delivery?.accountId),
        peerId: str(ctx.peerId ??
            ctx.chatId ??
            ctx.channelId ??
            event.peerId ??
            ctx.conversationId ??
            delivery?.chatId),
        senderId: str(ctx.senderId ??
            ctx.requesterSenderId ??
            event.senderId ??
            delivery?.senderId),
        agentId: str(ctx.agentId) ?? agentId,
        sessionGeneration: str(ctx.sessionGeneration ?? event.sessionGeneration),
    };
}
function str(v) {
    if (typeof v === "string" && v.trim())
        return v.trim();
    if (typeof v === "number" && Number.isFinite(v))
        return String(v);
    return null;
}
export function syncInvalidateIfTurnMismatch(runtime, turn) {
    syncHandshakeForTurn(runtime.store, turn);
}
export function registerAttachmentAdapter(api, runtime, _env = process.env) {
    if (runtime.bridge.kind === "mock" && !runtime.allowMockBridge) {
        api.logger?.warn?.("[wam-attachment-adapter] refused: mock bridge not allowed in production registration");
        return { ok: false, reason: "mock_bridge_forbidden" };
    }
    if (runtime.bridge.kind !== "stdio" && !runtime.allowMockBridge) {
        return { ok: false, reason: "production_bridge_required" };
    }
    if (!runtime.attachmentRoots.length) {
        return { ok: false, reason: "attachment_roots_required" };
    }
    const guard = assertOpenClawVersion(runtime.openclawVersion);
    if (!guard.ok) {
        api.logger?.warn?.(`[wam-attachment-adapter] refused to register: ${guard.reason}`);
        return { ok: false, reason: guard.reason };
    }
    api.on?.("message_received", (event, ctx) => {
        const merged = {
            ...event,
            sessionKey: event.sessionKey ?? ctx.sessionKey,
            messageId: event.messageId ?? ctx.messageId,
            senderId: event.senderId ?? ctx.senderId,
            accountId: event.accountId ?? ctx.accountId,
            peerId: event.peerId ?? ctx.conversationId ?? ctx.chatId ?? ctx.peerId,
        };
        const sessionKey = String(merged.sessionKey ?? "");
        const inboundGeneration = sessionKey
            ? runtime.store.beginMessageReceived(sessionKey)
            : undefined;
        const result = processMessageReceivedSequence(runtime.store, merged, {
            agentId: runtime.agentId,
            attachmentRoots: runtime.attachmentRoots,
            inboundGeneration,
        });
        if (result.status === "pending") {
            logAttachmentLifecycle(api.logger, "pending", {
                sessionKey,
            });
            api.logger?.info?.(`[wam-attachment-adapter] pending attachment index=${result.attachmentIndex} lifecycle=pending`);
        }
        else if (result.status === "instruction_observed") {
            logAttachmentLifecycle(api.logger, "instruction_observed", {
                sessionKey,
            });
        }
        else if (result.status === "invalidated") {
            logAttachmentLifecycle(api.logger, "invalidated", {
                sessionKey,
                reason: result.reason,
            });
        }
        else if (result.status === "error") {
            api.logger?.warn?.(`[wam-attachment-adapter] pending capture fail-closed: ${result.reason} missing=${(result.missingTrustedFields ?? []).join(",")}`);
        }
    });
    api.on?.("before_prompt_build", (event, ctx) => {
        const turn = turnFromCtx(event, ctx, runtime.agentId);
        const hs = syncHandshakeForTurn(runtime.store, turn);
        return { prependContext: hs.prependContext };
    });
    api.on?.("agent_end", (_event, ctx) => {
        runtime.store.onRunEnd(ctx.runId ? String(ctx.runId) : null);
    });
    api.on?.("command:new", (_event, ctx) => {
        const sessionKey = String(ctx.sessionKey ?? "");
        if (sessionKey)
            runtime.store.onSessionReset(sessionKey);
    });
    api.on?.("before_reset", (_event, ctx) => {
        const sessionKey = String(ctx.sessionKey ?? "");
        if (sessionKey)
            runtime.store.onSessionReset(sessionKey);
    });
    api.on?.("before_tool_call", (event, ctx) => {
        const name = String(event.toolName ?? event.name ?? "");
        if (shouldBlockRawDocumentTool(name)) {
            return {
                block: true,
                blockReason: "Raw wam.business.documents.* path tools are denied; use pathless inspect/parse/reconcile wrappers after the file->instruction handshake.",
            };
        }
        // Pathless wrappers stay callable; execute performs bounded wait + late-claim
        // + fail-closed checks. Do not hide them when instruction_observed is racing.
        void ctx;
    });
    for (const toolName of WRAPPER_TOOL_NAMES) {
        api.registerTool?.((toolCtx) => {
            // Always expose descriptors when alsoAllow permits — visibility must not
            // depend on an already-claimed attachment (live VPS catalogue race).
            const turn = turnFromCtx({}, toolCtx, runtime.agentId);
            return {
                name: toolName,
                description: wrapperDescription(toolName),
                parameters: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        sheet_index: { type: "integer", minimum: 0 },
                        sheet_name: { type: "string", maxLength: 120 },
                        installed_only: { type: "boolean" },
                        response_mode: {
                            type: "string",
                            enum: ["full", "number_only"],
                        },
                    },
                },
                async execute(_id, params) {
                    const liveTurn = turnFromCtx({}, toolCtx, runtime.agentId);
                    const result = await executeWrapperTool({
                        tool: toolName,
                        store: runtime.store,
                        bridge: runtime.bridge,
                        turn: {
                            ...turn,
                            ...liveTurn,
                            sessionKey: liveTurn.sessionKey || turn.sessionKey,
                            runId: liveTurn.runId ?? turn.runId,
                            peerId: liveTurn.peerId ?? turn.peerId,
                        },
                        args: params,
                        logger: api.logger,
                    });
                    if (!result.ok) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: result.userMessage ??
                                        result.error?.message ??
                                        "denied",
                                },
                            ],
                            details: {
                                ok: false,
                                category: result.error?.category ?? "denied",
                            },
                        };
                    }
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(result.data ?? {}),
                            },
                        ],
                        details: { ok: true },
                    };
                },
            };
        }, { name: toolName, optional: true });
    }
    api.logger?.info?.(`[wam-attachment-adapter] v0.2.2 registered openclaw=${guard.version} bridge=${runtime.bridge.kind} handshake=sequence-binding wrappers=always-catalogued core_patch=not_required`);
    return { ok: true };
}
function wrapperDescription(tool) {
    switch (tool) {
        case "inspect_current_business_document":
            return "Inspect the claimed spreadsheet from the prior file→instruction sequence (host-bound). Returns safe metadata only (filename, type, sheet, row estimate). No filesystem path argument.";
        case "parse_current_document_customers":
            return "Parse customers from the claimed attachment only (after inspect). No filesystem path argument.";
        case "reconcile_current_document_customers":
            return "Reconcile the claimed attachment against Agent Hub via MCP (after parse). Consumes the attachment. No filesystem path argument.";
    }
}
const plugin = definePluginEntry({
    id: "wam-attachment-adapter",
    name: "WAM Attachment Capability Adapter",
    description: "v0.2.2 plugin-only sequence binding on stock OpenClaw 2026.7.1-2: wrappers always catalogued; execute late-claims after bounded wait for instruction_observed.",
    register(api) {
        const version = resolveOpenClawVersion({
            apiConfig: api.config,
        });
        const guard = assertOpenClawVersion(version);
        if (!guard.ok) {
            api.logger?.warn?.(`[wam-attachment-adapter] refused to register: ${guard.reason}`);
            return;
        }
        let cfg;
        try {
            cfg = resolveStdioMcpBridgeConfigFromEnv();
        }
        catch (err) {
            api.logger?.warn?.(`[wam-attachment-adapter] refused: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        const available = assertStdioMcpBridgeAvailable(cfg);
        if (!available.ok) {
            api.logger?.warn?.(`[wam-attachment-adapter] refused: ${available.reason}`);
            return;
        }
        try {
            const bridge = createStdioMcpBridge(cfg);
            const runtime = createAdapterRuntime({
                bridge,
                openclawVersion: version,
                agentId: api.config?.agentId ??
                    "bonface-owner",
            });
            registerAttachmentAdapter(api, runtime);
        }
        catch (err) {
            api.logger?.warn?.(`[wam-attachment-adapter] refused: ${err instanceof Error ? err.message : String(err)}`);
        }
    },
});
export default plugin;
export { capturePendingAttachment, captureStagedAttachment, buildAttachmentPromptHint, buildFileAckPromptHint, buildPendingRacePromptHint, buildClaimedPromptHint, extractCaptureFields, } from "./attachment-capture.js";
export { processMessageReceivedSequence } from "./message-sequence.js";
export { CapabilityStore, globalCapabilityStore } from "./capability-store.js";
export { createStdioMcpBridge, createStdioMcpBridgeConfig, resolveStdioMcpBridgeConfigFromEnv, assertStdioMcpBridgeAvailable, } from "./mcp-bridge.js";
export { assertMcpPackageEntry, REQUIRED_MCP_PACKAGE_NAME, REQUIRED_MCP_PACKAGE_MIN_VERSION, } from "./mcp-package-guard.js";
export { applyAttachmentAdapterOpenClawPolicy, mergeToolsAlsoAllow, mergePluginsAllow, ADAPTER_PLUGIN_ID, REQUIRED_WRAPPER_ALSO_ALLOW, } from "./openclaw-config-policy.js";
export { executeWrapperTool, shouldBlockRawDocumentTool, } from "./wrapper-tools.js";
export { assertOpenClawVersion, resolveOpenClawVersion, } from "./version-guard.js";
export { assertBindingMatchesTurn } from "./binding-checks.js";
export { syncHandshakeForTurn, bindingUsableForTools, resolveBindingForToolsAsync, waitForInstructionObserved, } from "./handshake.js";
export { INSTRUCTION_OBSERVE_WAIT_MS, INSTRUCTION_OBSERVE_POLL_MS, } from "./types.js";
export * from "./types.js";
