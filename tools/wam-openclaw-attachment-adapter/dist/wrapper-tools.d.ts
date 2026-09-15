import type { CapabilityStore } from "./capability-store.js";
import { type LifecycleLogger } from "./lifecycle-log.js";
import type { McpBridge } from "./mcp-bridge.js";
import type { TurnIdentity, WrapperToolName, AttachmentBinding } from "./types.js";
export type WrapperResult = {
    ok: boolean;
    denied?: boolean;
    userMessage?: string;
    data?: unknown;
    error?: {
        category: string;
        message: string;
    };
};
export declare function executeWrapperTool(opts: {
    tool: WrapperToolName;
    store: CapabilityStore;
    bridge: McpBridge;
    turn: TurnIdentity;
    args?: Record<string, unknown>;
    logger?: LifecycleLogger;
    observeWaitMs?: number;
    observePollMs?: number;
    signal?: AbortSignal | null;
}): Promise<WrapperResult>;
/** @deprecated Prefer resolveBindingForToolsAsync at execute time. */
export declare function syncBindingForTools(store: CapabilityStore, turn: TurnIdentity): AttachmentBinding | null;
/** Safe metadata for the model — never paths or capability IDs. */
export declare function toSafeToolPayload(tool: WrapperToolName, binding: AttachmentBinding, data: unknown): unknown;
export declare function redactHostPaths(data: unknown): unknown;
export declare function shouldBlockRawDocumentTool(toolName: string): boolean;
