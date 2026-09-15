/**
 * Deterministic local MCP package version gate for wam-apps-ai-mcp.
 * Does not trust env-supplied version strings — reads package.json under the entry.
 */
export declare const REQUIRED_MCP_PACKAGE_NAME = "wam-apps-ai-mcp";
export declare const REQUIRED_MCP_PACKAGE_MIN_VERSION = "0.1.18";
export type McpPackageGuardOk = {
    ok: true;
    packageName: string;
    version: string;
    packageRoot: string;
    entryRealPath: string;
};
export type McpPackageGuardFail = {
    ok: false;
    reason: string;
};
export type McpPackageGuardResult = McpPackageGuardOk | McpPackageGuardFail;
/** Compare a.b.c; returns negative if a<b, 0 if equal, positive if a>b. */
export declare function compareSemVer(a: string, b: string): number | null;
/**
 * Fail-closed: WAM_ATTACHMENT_MCP_ENTRY must resolve under a local
 * wam-apps-ai-mcp package whose version is >= minVersion.
 */
export declare function assertMcpPackageEntry(mcpEntryPath: string, opts?: {
    packageName?: string;
    minVersion?: string;
}): McpPackageGuardResult;
