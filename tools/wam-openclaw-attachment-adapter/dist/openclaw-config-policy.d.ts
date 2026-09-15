/**
 * Idempotent openclaw.json policy merges for adapter wrappers + plugin allowlist.
 * Preserves tools.profile and existing allow entries; never replaces arrays wholesale.
 */
export declare const ADAPTER_PLUGIN_ID = "wam-attachment-adapter";
export declare const REQUIRED_WRAPPER_ALSO_ALLOW: ("inspect_current_business_document" | "parse_current_document_customers" | "reconcile_current_document_customers")[];
/**
 * Merge tools.alsoAllow while preserving tools.profile (default expectation: "coding").
 * Does not remove other alsoAllow entries. Does not change deny lists.
 */
export declare function mergeToolsAlsoAllow(config: Record<string, unknown>, wrappers?: readonly string[]): {
    config: Record<string, unknown>;
    profile: string | null;
    alsoAllow: string[];
};
/**
 * Append plugin id to plugins.allow without replacing existing trusted IDs.
 * If plugins.allow is absent, creates it with only the adapter id (caller may
 * prefer leaving allow unset — runbook documents preserve-all-then-add).
 */
export declare function mergePluginsAllow(config: Record<string, unknown>, pluginId?: string): {
    config: Record<string, unknown>;
    allow: string[];
    createdAllow: boolean;
};
/** Apply both merges (idempotent). */
export declare function applyAttachmentAdapterOpenClawPolicy(config: Record<string, unknown>): Record<string, unknown>;
