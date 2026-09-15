/**
 * Test-only MCP bridge. Do not import from production plugin registration.
 */
import type {
  McpBridge,
  McpBridgeRequest,
  McpBridgeResult,
} from "./mcp-bridge.js";

export function createMockMcpBridge(
  handler?: (req: McpBridgeRequest) => Promise<McpBridgeResult> | McpBridgeResult,
): McpBridge & { calls: McpBridgeRequest[] } {
  const calls: McpBridgeRequest[] = [];
  return {
    kind: "mock",
    calls,
    async callDocumentTool(req) {
      calls.push(req);
      if (handler) return handler(req);
      return {
        ok: true,
        data: {
          status: "success",
          operation: req.tool,
          note: "mock_mcp_bridge",
          path_injected_by_host: true,
        },
      };
    },
  };
}
