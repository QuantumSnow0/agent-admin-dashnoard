/**
 * Idempotent openclaw.json policy merges for adapter wrappers + plugin allowlist.
 * Preserves tools.profile and existing allow entries; never replaces arrays wholesale.
 */
import { WRAPPER_TOOL_NAMES } from "./types.js";
export const ADAPTER_PLUGIN_ID = "wam-attachment-adapter";
export const REQUIRED_WRAPPER_ALSO_ALLOW = [...WRAPPER_TOOL_NAMES];
function asStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.filter((x) => typeof x === "string" && x.trim().length > 0);
}
function uniqueAppend(existing, required) {
    const out = [...existing];
    const seen = new Set(existing);
    for (const id of required) {
        if (!seen.has(id)) {
            out.push(id);
            seen.add(id);
        }
    }
    return out;
}
/**
 * Merge tools.alsoAllow while preserving tools.profile (default expectation: "coding").
 * Does not remove other alsoAllow entries. Does not change deny lists.
 */
export function mergeToolsAlsoAllow(config, wrappers = REQUIRED_WRAPPER_ALSO_ALLOW) {
    const tools = config.tools && typeof config.tools === "object" && !Array.isArray(config.tools)
        ? { ...config.tools }
        : {};
    const profile = typeof tools.profile === "string" && tools.profile.trim()
        ? tools.profile.trim()
        : null;
    const alsoAllow = uniqueAppend(asStringArray(tools.alsoAllow), wrappers);
    tools.alsoAllow = alsoAllow;
    return {
        config: { ...config, tools },
        profile,
        alsoAllow,
    };
}
/**
 * Append plugin id to plugins.allow without replacing existing trusted IDs.
 * If plugins.allow is absent, creates it with only the adapter id (caller may
 * prefer leaving allow unset — runbook documents preserve-all-then-add).
 */
export function mergePluginsAllow(config, pluginId = ADAPTER_PLUGIN_ID) {
    const plugins = config.plugins && typeof config.plugins === "object" && !Array.isArray(config.plugins)
        ? { ...config.plugins }
        : {};
    const createdAllow = !Object.prototype.hasOwnProperty.call(plugins, "allow");
    const allow = uniqueAppend(asStringArray(plugins.allow), [pluginId]);
    plugins.allow = allow;
    return {
        config: { ...config, plugins },
        allow,
        createdAllow,
    };
}
/** Apply both merges (idempotent). */
export function applyAttachmentAdapterOpenClawPolicy(config) {
    const withTools = mergeToolsAlsoAllow(config).config;
    return mergePluginsAllow(withTools).config;
}
