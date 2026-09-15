import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertMcpPackageEntry,
  REQUIRED_MCP_PACKAGE_MIN_VERSION,
  REQUIRED_MCP_PACKAGE_NAME,
} from "../src/mcp-package-guard.js";
import {
  applyAttachmentAdapterOpenClawPolicy,
  mergePluginsAllow,
  mergeToolsAlsoAllow,
  ADAPTER_PLUGIN_ID,
} from "../src/openclaw-config-policy.js";
import { assertStdioMcpBridgeAvailable } from "../src/mcp-bridge.js";
import { shouldBlockRawDocumentTool } from "../src/wrapper-tools.js";

function writeFakeMcpPackage(opts: {
  name: string;
  version: string;
  entryRel?: string;
}): { root: string; entry: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wam-mcp-pkg-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: opts.name, version: opts.version }, null, 2),
  );
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist);
  const entryRel = opts.entryRel ?? "dist/index.js";
  const entry = path.join(root, entryRel);
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "export {};\n");
  return {
    root,
    entry,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("MCP package version gate", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("rejects v0.1.17", () => {
    const pkg = writeFakeMcpPackage({
      name: REQUIRED_MCP_PACKAGE_NAME,
      version: "0.1.17",
    });
    cleanups.push(pkg.cleanup);
    const r = assertMcpPackageEntry(pkg.entry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mcp_version_unsupported:0\.1\.17/);
  });

  it("accepts v0.1.18", () => {
    const pkg = writeFakeMcpPackage({
      name: REQUIRED_MCP_PACKAGE_NAME,
      version: "0.1.18",
    });
    cleanups.push(pkg.cleanup);
    const r = assertMcpPackageEntry(pkg.entry);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.version).toBe("0.1.18");
  });

  it("accepts later compatible version", () => {
    const pkg = writeFakeMcpPackage({
      name: REQUIRED_MCP_PACKAGE_NAME,
      version: "0.1.20",
    });
    cleanups.push(pkg.cleanup);
    const r = assertMcpPackageEntry(pkg.entry);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.version).toBe("0.1.20");
  });

  it("rejects wrong package name", () => {
    const pkg = writeFakeMcpPackage({
      name: "not-wam-apps-ai-mcp",
      version: "0.1.18",
    });
    cleanups.push(pkg.cleanup);
    const r = assertMcpPackageEntry(pkg.entry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mcp_package_name_mismatch/);
  });

  it("rejects missing package.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wam-mcp-nopkg-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const entry = path.join(dir, "index.js");
    fs.writeFileSync(entry, "export {};\n");
    const r = assertMcpPackageEntry(entry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("mcp_package_json_missing");
  });

  it("rejects malformed version metadata", () => {
    const pkg = writeFakeMcpPackage({
      name: REQUIRED_MCP_PACKAGE_NAME,
      version: "not-a-semver",
    });
    cleanups.push(pkg.cleanup);
    const r = assertMcpPackageEntry(pkg.entry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mcp_version_malformed/);
  });

  it("assertStdioMcpBridgeAvailable enforces hard floor 0.1.18", () => {
    expect(REQUIRED_MCP_PACKAGE_MIN_VERSION).toBe("0.1.18");
    const bad = writeFakeMcpPackage({
      name: REQUIRED_MCP_PACKAGE_NAME,
      version: "0.1.17",
    });
    cleanups.push(bad.cleanup);
    const r = assertStdioMcpBridgeAvailable({
      mcpEntryPath: bad.entry,
      requiredMcpPackageVersion: "0.0.1", // must not weaken floor
    });
    expect(r.ok).toBe(false);
  });
});

describe("openclaw.json policy merge", () => {
  it("preserves tools.profile=coding and appends wrappers", () => {
    const { config, profile, alsoAllow } = mergeToolsAlsoAllow({
      tools: {
        profile: "coding",
        alsoAllow: ["sessions_spawn"],
      },
    });
    expect(profile).toBe("coding");
    expect((config.tools as { profile: string }).profile).toBe("coding");
    expect(alsoAllow).toEqual([
      "sessions_spawn",
      "inspect_current_business_document",
      "parse_current_document_customers",
      "reconcile_current_document_customers",
    ]);
  });

  it("plugins.allow appends adapter without replacing trusted ids", () => {
    const { allow } = mergePluginsAllow({
      plugins: { allow: ["telegram", "browser"] },
    });
    expect(allow).toEqual(["telegram", "browser", ADAPTER_PLUGIN_ID]);
  });

  it("applyAttachmentAdapterOpenClawPolicy is idempotent", () => {
    const once = applyAttachmentAdapterOpenClawPolicy({
      tools: { profile: "coding" },
      plugins: { allow: ["telegram"] },
    });
    const twice = applyAttachmentAdapterOpenClawPolicy(once);
    expect(twice).toEqual(once);
  });

  it("raw wam.business.documents.* remain blocked (not for alsoAllow)", () => {
    expect(
      shouldBlockRawDocumentTool("wam.business.documents.inspect_business_document"),
    ).toBe(true);
    expect(
      shouldBlockRawDocumentTool("inspect_current_business_document"),
    ).toBe(false);
  });
});
