/**
 * Bridge from host adapter → Phase 1A.8 MCP (v0.1.18+).
 * The model never sees attachment_path; only this host bridge injects it.
 */
import fs from "node:fs";
import path from "node:path";
import { assertMcpPackageEntry, REQUIRED_MCP_PACKAGE_MIN_VERSION, } from "./mcp-package-guard.js";
const TOOL_FQN = {
    inspect_business_document: "wam.business.documents.inspect_business_document",
    parse_document_customers: "wam.business.documents.parse_document_customers",
    reconcile_document_customers: "wam.business.documents.reconcile_document_customers",
};
/** Assert production bridge config + MCP package version (sync fail-closed). */
export function assertStdioMcpBridgeAvailable(opts) {
    if (!opts.mcpEntryPath?.trim()) {
        return { ok: false, reason: "stdio_mcp_bridge_missing_entry" };
    }
    const entry = path.resolve(opts.mcpEntryPath.trim());
    if (!fs.existsSync(entry)) {
        return { ok: false, reason: `stdio_mcp_bridge_entry_not_found:${entry}` };
    }
    // Floor is always the hard-coded constant — never trust env/config version strings.
    const pkg = assertMcpPackageEntry(entry, {
        minVersion: REQUIRED_MCP_PACKAGE_MIN_VERSION,
    });
    if (!pkg.ok) {
        return { ok: false, reason: pkg.reason };
    }
    return { ok: true, entry: pkg.entryRealPath, mcpVersion: pkg.version };
}
/**
 * Production host→MCP stdio invocation (lazy connect on first tool call).
 * Registration must call assertStdioMcpBridgeAvailable first.
 */
export function createStdioMcpBridge(opts) {
    const asserted = assertStdioMcpBridgeAvailable(opts);
    if (!asserted.ok) {
        throw new Error(asserted.reason);
    }
    const entry = asserted.entry;
    let clientPromise = null;
    async function getClient() {
        if (!clientPromise) {
            clientPromise = (async () => {
                const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
                const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
                const transport = new StdioClientTransport({
                    command: opts.nodePath ?? process.execPath,
                    args: [entry],
                    env: { ...process.env, ...(opts.env ?? {}) },
                });
                const client = new Client({
                    name: "wam-openclaw-attachment-adapter",
                    version: "0.2.2",
                }, { capabilities: {} });
                await client.connect(transport);
                return client;
            })();
        }
        return clientPromise;
    }
    return {
        kind: "stdio",
        async callDocumentTool(req) {
            try {
                const client = await getClient();
                const name = TOOL_FQN[req.tool];
                const args = {
                    ...(req.args ?? {}),
                    attachment_path: req.attachmentPath,
                };
                delete args.attachmentPath;
                delete args.path;
                const result = (await client.callTool({ name, arguments: args }));
                const isError = Boolean(result.isError);
                const content = result.content;
                let data = content;
                if (Array.isArray(content)) {
                    const text = content
                        .filter((c) => !!c &&
                        typeof c === "object" &&
                        c.type === "text" &&
                        typeof c.text === "string")
                        .map((c) => c.text)
                        .join("\n");
                    try {
                        data = JSON.parse(text);
                    }
                    catch {
                        data = { text };
                    }
                }
                if (isError) {
                    return {
                        ok: false,
                        error: {
                            category: "mcp_tool_error",
                            message: typeof data === "object" ? JSON.stringify(data) : String(data),
                        },
                    };
                }
                return { ok: true, data };
            }
            catch (err) {
                return {
                    ok: false,
                    error: {
                        category: "mcp_bridge_failure",
                        message: err instanceof Error ? err.message : "mcp_call_failed",
                    },
                };
            }
        },
        async close() {
            if (!clientPromise)
                return;
            const client = await clientPromise;
            await client.close();
        },
    };
}
export function resolveStdioMcpBridgeConfigFromEnv(env = process.env) {
    const mcpEntryPath = env.WAM_ATTACHMENT_MCP_ENTRY?.trim() ||
        env.WAM_MCP_ENTRY?.trim() ||
        "";
    if (!mcpEntryPath) {
        throw new Error("stdio_mcp_bridge_unconfigured: set WAM_ATTACHMENT_MCP_ENTRY to wam-apps-ai-mcp dist/index.js");
    }
    return {
        mcpEntryPath,
        nodePath: env.WAM_ATTACHMENT_MCP_NODE?.trim() || undefined,
        requiredMcpPackageVersion: "0.1.18",
    };
}
export function createStdioMcpBridgeConfig() {
    return {
        requiredMcpPackageVersion: "0.1.18",
        toolNamePrefix: "wam.business.documents.",
        envVars: [
            "WAM_ATTACHMENT_MCP_ENTRY",
            "WAM_ATTACHMENT_MCP_NODE",
            "OPENCLAW_VERSION",
            "WAM_AI_ATTACHMENT_ROOTS",
        ],
        note: "Host injects attachment_path from capability store; model tools never accept paths. Mock bridge is test-only (mcp-bridge.mock.ts).",
    };
}
