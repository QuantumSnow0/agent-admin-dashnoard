/**
 * Registration gates for the preflight plugin (no OpenClaw SDK import).
 */
import { type LiveHookPreflightApi } from "./presence.js";
export type PluginApiLike = LiveHookPreflightApi & {
    config?: Record<string, unknown>;
};
export declare function tryRegisterPreflightPlugin(api: PluginApiLike, env?: NodeJS.ProcessEnv): {
    ok: boolean;
    reason: string;
};
