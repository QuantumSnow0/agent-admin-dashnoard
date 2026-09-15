const ORDER = {
    pending: 0,
    instruction_observed: 1,
    claimed: 2,
    inspected: 3,
    mapped: 4,
    reconciled: 5,
    consumed: 6,
};
export function canAdvanceLifecycle(current, next) {
    if (current === "consumed")
        return false;
    if (next === "consumed")
        return true;
    return ORDER[next] >= ORDER[current];
}
export function lifecycleTargetForTool(tool) {
    switch (tool) {
        case "inspect_current_business_document":
            return "inspected";
        case "parse_current_document_customers":
            return "mapped";
        case "reconcile_current_document_customers":
            return "reconciled";
    }
}
/**
 * Strict pipeline after claim: inspect → parse → reconcile.
 * Inspect allowed from claimed; parse requires inspected+; reconcile requires mapped+.
 */
export function assertToolAllowedAtLifecycle(binding, tool) {
    if (binding.consumed || binding.lifecycle === "consumed") {
        return { ok: false, reason: "already_consumed" };
    }
    if (binding.lifecycle === "pending" ||
        binding.lifecycle === "instruction_observed") {
        return { ok: false, reason: "still_pending" };
    }
    const state = binding.lifecycle;
    switch (tool) {
        case "inspect_current_business_document":
            if (ORDER[state] < ORDER.claimed) {
                return { ok: false, reason: "must_claim_before_inspect" };
            }
            if (ORDER[state] > ORDER.mapped) {
                return { ok: false, reason: "lifecycle_past_inspect" };
            }
            return { ok: true };
        case "parse_current_document_customers":
            if (ORDER[state] < ORDER.inspected) {
                return { ok: false, reason: "must_inspect_before_parse" };
            }
            if (ORDER[state] > ORDER.mapped) {
                return { ok: false, reason: "lifecycle_past_parse" };
            }
            return { ok: true };
        case "reconcile_current_document_customers":
            if (ORDER[state] < ORDER.mapped) {
                return { ok: false, reason: "must_parse_before_reconcile" };
            }
            return { ok: true };
    }
}
export function advanceLifecycle(binding, next) {
    if (!canAdvanceLifecycle(binding.lifecycle, next)) {
        throw new Error(`invalid_lifecycle_transition:${binding.lifecycle}->${next}`);
    }
    binding.lifecycle = next;
    if (next === "consumed") {
        binding.consumed = true;
    }
}
