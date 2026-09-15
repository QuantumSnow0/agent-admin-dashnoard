import type { AttachmentBinding, CapabilityLifecycleState, WrapperToolName } from "./types.js";
export declare function canAdvanceLifecycle(current: CapabilityLifecycleState, next: CapabilityLifecycleState): boolean;
export declare function lifecycleTargetForTool(tool: WrapperToolName): CapabilityLifecycleState;
/**
 * Strict pipeline after claim: inspect → parse → reconcile.
 * Inspect allowed from claimed; parse requires inspected+; reconcile requires mapped+.
 */
export declare function assertToolAllowedAtLifecycle(binding: AttachmentBinding, tool: WrapperToolName): {
    ok: true;
} | {
    ok: false;
    reason: string;
};
export declare function advanceLifecycle(binding: AttachmentBinding, next: CapabilityLifecycleState): void;
