/**
 * Bridge from host adapter → Phase 1A.8 MCP (v0.1.18+).
 * The model never sees attachment_path; only this host bridge injects it.
 */
export type McpDocumentTool = "inspect_business_document" | "parse_document_customers" | "reconcile_document_customers";
export type McpBridgeRequest = {
    tool: McpDocumentTool;
    attachmentPath: string;
    /** Extra args excluding attachment_path (sheet/mapping/response_mode). */
    args?: Record<string, unknown>;
};
export type McpBridgeResult = {
    ok: boolean;
    data?: unknown;
    error?: {
        category: string;
        message: string;
    };
};
export type McpBridgeKind = "stdio" | "mock";
export type McpBridge = {
    readonly kind: McpBridgeKind;
    callDocumentTool: (req: McpBridgeRequest) => Promise<McpBridgeResult>;
    close?: () => Promise<void>;
};
export type StdioMcpBridgeOptions = {
    nodePath?: string;
    mcpEntryPath: string;
    env?: NodeJS.ProcessEnv;
    requiredMcpPackageVersion?: string;
};
/** Assert production bridge config + MCP package version (sync fail-closed). */
export declare function assertStdioMcpBridgeAvailable(opts: StdioMcpBridgeOptions): {
    ok: true;
    entry: string;
    mcpVersion: string;
} | {
    ok: false;
    reason: string;
};
/**
 * Production host→MCP stdio invocation (lazy connect on first tool call).
 * Registration must call assertStdioMcpBridgeAvailable first.
 */
export declare function createStdioMcpBridge(opts: StdioMcpBridgeOptions): McpBridge;
export declare function resolveStdioMcpBridgeConfigFromEnv(env?: NodeJS.ProcessEnv): StdioMcpBridgeOptions;
export declare function createStdioMcpBridgeConfig(): {
    requiredMcpPackageVersion: string;
    toolNamePrefix: string;
    envVars: string[];
    note: string;
};
