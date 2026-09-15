/**
 * Binding semantics proof for adapter v0.2.1 on stock OpenClaw 2026.7.1-2.
 *
 * Plugin-only sequence binding is ACCEPTED for the private bonface-owner
 * Telegram session with explicitly documented residual risk.
 */
export const OPENCLAW_HOOK_ORDERING_PROOF = {
  openclawVersion: "2026.7.1-2",
  adapterVersion: "0.2.2",
  pluginOnly: "ACCEPTED_SEQUENCE_BINDING",
  corePatchRequired: null,
  claimGate: "sessionKey_peerId_runId_after_instruction_observed",
  toolGate: "always_catalogued_wrappers_execute_late_claim",
  trustModel: "sequence_binding_not_cryptographic_message_to_prompt",
  residualRisk:
    "A delayed/out-of-order before_prompt_build after instruction_observed cannot be distinguished from the instruction prompt without messageId",
  observedLiveSinglePrompt: "file_mr_then_instruction_mr_then_one_bpb_claims",
  mcpPackageMinVersion: "0.1.18",
  contentDuplicateGate: "sha256_reservation_on_first_wrapper_revalidation",
  instructionRaceFix: "always_expose_wrappers_bounded_wait_late_claim",
} as const;
