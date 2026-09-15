export function createMockMcpBridge(handler) {
    const calls = [];
    return {
        kind: "mock",
        calls,
        async callDocumentTool(req) {
            calls.push(req);
            if (handler)
                return handler(req);
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
