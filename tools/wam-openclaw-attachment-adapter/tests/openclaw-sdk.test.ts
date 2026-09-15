/**
 * Compile / type-contract tests against real openclaw@2026.7.1-2 SDK.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import plugin from "../src/index.js";
import { OPENCLAW_VERSION_GUARD } from "../src/types.js";

describe("OpenClaw 2026.7.1-2 SDK contracts", () => {
  it("devDependency openclaw resolves to 2026.7.1-2", () => {
    const pkgPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "node_modules",
      "openclaw",
      "package.json",
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      version: string;
    };
    expect(pkg.version).toBe("2026.7.1-2");
  });

  it("default export is a definePluginEntry-shaped plugin", () => {
    expect(plugin.id).toBe("wam-attachment-adapter");
    expect(typeof plugin.register).toBe("function");
    expect(plugin.name).toContain("Attachment");
  });

  it("definePluginEntry accepts our registration shape", () => {
    const entry = definePluginEntry({
      id: "wam-attachment-adapter-sdk-smoke",
      name: "sdk smoke",
      description: "type-level smoke",
      register() {
        /* no-op */
      },
    });
    expect(entry.id).toBe("wam-attachment-adapter-sdk-smoke");
  });

  it("version guard includes installed SDK version", () => {
    expect(
      (OPENCLAW_VERSION_GUARD.allowedExact as readonly string[]).includes(
        "2026.7.1-2",
      ),
    ).toBe(true);
  });
});
