/**
 * Installable OpenClaw plugin: live-hook presence preflight only.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { tryRegisterPreflightPlugin, type PluginApiLike } from "./register.js";

const plugin = definePluginEntry({
  id: "wam-live-hook-preflight",
  name: "WAM Live-Hook Preflight (read-only)",
  description:
    "Presence-only probes for OpenClaw 2026.7.1-2. No capture, MCP, tools, or database. Requires WAM_LIVE_HOOK_PREFLIGHT_ENABLED=1.",
  register(api) {
    tryRegisterPreflightPlugin(api as PluginApiLike);
  },
});

export default plugin as unknown as {
  id: string;
  name: string;
  description: string;
  register: (api: PluginApiLike) => void;
};

export { tryRegisterPreflightPlugin } from "./register.js";
export type { PluginApiLike } from "./register.js";
export {
  CAPTURE_IDENTITY_FIELDS,
  LIVE_HOOK_NAMES,
  createLiveHookPreflightState,
  evaluatePreflightPass,
  formatPresenceLogLine,
  isPreflightExplicitlyEnabled,
  isScalarIdentityValue,
  registerLiveHookPreflight,
  scanHookFieldPresence,
} from "./presence.js";
export {
  assertOpenClawVersion,
  resolveOpenClawVersion,
  ALLOWED_OPENCLAW_VERSIONS,
} from "./version-guard.js";
