/**
 * Installable OpenClaw plugin: live-hook presence preflight only.
 */
import { type PluginApiLike } from "./register.js";
declare const _default: {
    id: string;
    name: string;
    description: string;
    register: (api: PluginApiLike) => void;
};
export default _default;
export { tryRegisterPreflightPlugin } from "./register.js";
export type { PluginApiLike } from "./register.js";
export { CAPTURE_IDENTITY_FIELDS, LIVE_HOOK_NAMES, createLiveHookPreflightState, evaluatePreflightPass, formatPresenceLogLine, isPreflightExplicitlyEnabled, isScalarIdentityValue, registerLiveHookPreflight, scanHookFieldPresence, } from "./presence.js";
export { assertOpenClawVersion, resolveOpenClawVersion, ALLOWED_OPENCLAW_VERSIONS, } from "./version-guard.js";
