/**
 * Registration gates for the preflight plugin (no OpenClaw SDK import).
 */
import { createLiveHookPreflightState, isPreflightExplicitlyEnabled, registerLiveHookPreflight, } from "./presence.js";
import { assertOpenClawVersion, resolveOpenClawVersion, } from "./version-guard.js";
export function tryRegisterPreflightPlugin(api, env = process.env) {
    if (!isPreflightExplicitlyEnabled(env)) {
        api.logger?.warn?.("[wam-live-hook-preflight] refused: set WAM_LIVE_HOOK_PREFLIGHT_ENABLED=1 for explicit operator enablement");
        return { ok: false, reason: "explicit_enablement_required" };
    }
    const version = resolveOpenClawVersion({
        env,
        apiConfig: api.config,
    });
    const guard = assertOpenClawVersion(version);
    if (!guard.ok) {
        api.logger?.warn?.(`[wam-live-hook-preflight] refused: ${guard.reason}`);
        return { ok: false, reason: guard.reason };
    }
    const state = createLiveHookPreflightState();
    registerLiveHookPreflight(api, state);
    api.logger?.info?.(`[wam-live-hook-preflight] active (read-only) openclaw=${guard.version}`);
    return { ok: true, reason: "registered" };
}
