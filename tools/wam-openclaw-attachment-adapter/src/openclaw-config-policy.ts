/**
 * Idempotent openclaw.json policy merges for adapter wrappers + plugin allowlist.
 * Preserves tools.profile and existing allow entries; never replaces arrays wholesale.
 */

import { WRAPPER_TOOL_NAMES } from "./types.js";

export const ADAPTER_PLUGIN_ID = "wam-attachment-adapter";

export const REQUIRED_WRAPPER_ALSO_ALLOW = [...WRAPPER_TOOL_NAMES];

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function uniqueAppend(existing: string[], required: readonly string[]): string[] {
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
export function mergeToolsAlsoAllow(
  config: Record<string, unknown>,
  wrappers: readonly string[] = REQUIRED_WRAPPER_ALSO_ALLOW,
): {
  config: Record<string, unknown>;
  profile: string | null;
  alsoAllow: string[];
} {
  const tools =
    config.tools && typeof config.tools === "object" && !Array.isArray(config.tools)
      ? { ...(config.tools as Record<string, unknown>) }
      : {};
  const profile =
    typeof tools.profile === "string" && tools.profile.trim()
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
export function mergePluginsAllow(
  config: Record<string, unknown>,
  pluginId: string = ADAPTER_PLUGIN_ID,
): {
  config: Record<string, unknown>;
  allow: string[];
  createdAllow: boolean;
} {
  const plugins =
    config.plugins && typeof config.plugins === "object" && !Array.isArray(config.plugins)
      ? { ...(config.plugins as Record<string, unknown>) }
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
export function applyAttachmentAdapterOpenClawPolicy(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const withTools = mergeToolsAlsoAllow(config).config;
  return mergePluginsAllow(withTools).config;
}
