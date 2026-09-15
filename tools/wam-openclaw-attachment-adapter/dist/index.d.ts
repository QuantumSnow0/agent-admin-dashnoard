/**
 * OpenClaw plugin entry — host-side attachment capability adapter v0.2.2.
 *
 * Plugin-only sequence binding on stock OpenClaw 2026.7.1-2 (no core patch).
 * Wrappers are always catalogued when alsoAllow permits; execute waits briefly
 * for async instruction_observed then late-claims (live VPS race fix).
 */
import { type McpBridge } from "./mcp-bridge.js";
import type { TurnIdentity } from "./types.js";
import type { CapabilityStore } from "./capability-store.js";
export type PluginApiLike = {
    logger?: {
        info?: (m: string) => void;
        warn?: (m: string) => void;
    };
    on?: (hook: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown, opts?: Record<string, unknown>) => void;
    registerTool?: (tool: Record<string, unknown> | ((ctx: Record<string, unknown>) => Record<string, unknown> | null), opts?: Record<string, unknown>) => void;
    config?: Record<string, unknown>;
};
export type AdapterRuntime = {
    store: CapabilityStore;
    bridge: McpBridge;
    openclawVersion: string | null;
    agentId: string;
    attachmentRoots: string[];
    allowMockBridge?: boolean;
};
export declare function createAdapterRuntime(opts: {
    bridge: McpBridge;
    openclawVersion?: string | null;
    agentId?: string;
    attachmentRoots?: string[];
}): AdapterRuntime;
export declare function createTestAdapterRuntime(opts: {
    bridge: McpBridge;
    openclawVersion?: string | null;
    agentId?: string;
    store?: CapabilityStore;
    attachmentRoots?: string[];
}): AdapterRuntime;
export declare function turnFromCtx(event: Record<string, unknown>, ctx: Record<string, unknown>, agentId: string): TurnIdentity;
export declare function syncInvalidateIfTurnMismatch(runtime: AdapterRuntime, turn: TurnIdentity): void;
export declare function registerAttachmentAdapter(api: PluginApiLike, runtime: AdapterRuntime, _env?: NodeJS.ProcessEnv): {
    ok: boolean;
    reason?: string;
};
declare const _default: {
    id: string;
    name: string;
    description: string;
    register: (api: PluginApiLike) => void;
};
export default _default;
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
