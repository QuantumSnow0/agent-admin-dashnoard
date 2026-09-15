/**
 * Test-only MCP bridge. Do not import from production plugin registration.
 */
import type { McpBridge, McpBridgeRequest, McpBridgeResult } from "./mcp-bridge.js";
export declare function createMockMcpBridge(handler?: (req: McpBridgeRequest) => Promise<McpBridgeResult> | McpBridgeResult): McpBridge & {
    calls: McpBridgeRequest[];
};
