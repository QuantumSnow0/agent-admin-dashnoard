/**
 * Deterministic local MCP package version gate for wam-apps-ai-mcp.
 * Does not trust env-supplied version strings — reads package.json under the entry.
 */
import fs from "node:fs";
import path from "node:path";
export const REQUIRED_MCP_PACKAGE_NAME = "wam-apps-ai-mcp";
export const REQUIRED_MCP_PACKAGE_MIN_VERSION = "0.1.18";
function parseSemVer(raw) {
    const m = String(raw)
        .trim()
        .match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!m)
        return null;
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
    };
}
/** Compare a.b.c; returns negative if a<b, 0 if equal, positive if a>b. */
export function compareSemVer(a, b) {
    const pa = parseSemVer(a);
    const pb = parseSemVer(b);
    if (!pa || !pb)
        return null;
    if (pa.major !== pb.major)
        return pa.major - pb.major;
    if (pa.minor !== pb.minor)
        return pa.minor - pb.minor;
    return pa.patch - pb.patch;
}
function realpathOrResolve(p) {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return path.resolve(p);
    }
}
function isPathInsideRoot(child, root) {
    const rel = path.relative(root, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
function findPackageRootForEntry(entryRealPath) {
    let dir = path.dirname(entryRealPath);
    const { root } = path.parse(dir);
    while (true) {
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
            try {
                const raw = fs.readFileSync(pkgPath, "utf8");
                const pkg = JSON.parse(raw);
                return { packageRoot: dir, pkg };
            }
            catch {
                return null;
            }
        }
        if (dir === root)
            return null;
        const parent = path.dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
}
/**
 * Fail-closed: WAM_ATTACHMENT_MCP_ENTRY must resolve under a local
 * wam-apps-ai-mcp package whose version is >= minVersion.
 */
export function assertMcpPackageEntry(mcpEntryPath, opts) {
    const packageName = opts?.packageName ?? REQUIRED_MCP_PACKAGE_NAME;
    const minVersion = opts?.minVersion ?? REQUIRED_MCP_PACKAGE_MIN_VERSION;
    if (!mcpEntryPath?.trim()) {
        return { ok: false, reason: "stdio_mcp_bridge_missing_entry" };
    }
    const resolved = path.resolve(mcpEntryPath.trim());
    if (!fs.existsSync(resolved)) {
        return { ok: false, reason: `stdio_mcp_bridge_entry_not_found:${resolved}` };
    }
    let entryRealPath;
    try {
        entryRealPath = fs.realpathSync(resolved);
    }
    catch {
        return { ok: false, reason: "mcp_entry_realpath_failed" };
    }
    const found = findPackageRootForEntry(entryRealPath);
    if (!found) {
        return { ok: false, reason: "mcp_package_json_missing" };
    }
    const packageRootReal = realpathOrResolve(found.packageRoot);
    if (!isPathInsideRoot(entryRealPath, packageRootReal)) {
        return { ok: false, reason: "mcp_entry_outside_package_root" };
    }
    const name = found.pkg.name;
    if (typeof name !== "string" || !name.trim()) {
        return { ok: false, reason: "mcp_package_name_missing" };
    }
    if (name.trim() !== packageName) {
        return { ok: false, reason: `mcp_package_name_mismatch:${name.trim()}` };
    }
    const version = found.pkg.version;
    if (typeof version !== "string" || !version.trim()) {
        return { ok: false, reason: "mcp_version_missing" };
    }
    const ver = version.trim();
    if (!parseSemVer(ver)) {
        return { ok: false, reason: `mcp_version_malformed:${ver}` };
    }
    const cmp = compareSemVer(ver, minVersion);
    if (cmp == null) {
        return { ok: false, reason: `mcp_version_malformed:${ver}` };
    }
    if (cmp < 0) {
        return {
            ok: false,
            reason: `mcp_version_unsupported:${ver}<${minVersion}`,
        };
    }
    return {
        ok: true,
        packageName,
        version: ver,
        packageRoot: packageRootReal,
        entryRealPath,
    };
}
