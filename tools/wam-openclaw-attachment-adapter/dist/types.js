/**
 * Attachment capability types — adapter v0.2.1 (plugin-only sequence binding).
 *
 * Trust model (explicitly weaker than cryptographic message-to-prompt binding):
 * file message_received → instruction message_received (same identity) →
 * sole subsequent before_prompt_build claims via sessionKey + peerId + runId.
 * Stock OpenClaw 2026.7.1-2 does not expose messageId on before_prompt_build;
 * that omission is accepted for the private bonface-owner Telegram session.
 *
 * See patches/PLUGIN-ONLY-SEQUENCE-BINDING.md and the runbook residual-risk section.
 */
/** Maximum pending TTL: 120 seconds. */
export const PENDING_TTL_MS = 120_000;
export const MAX_LATE_CLAIM_ATTEMPTS = 1;
/**
 * Bounded wait for async instruction message_received to reach
 * instruction_observed before wrapper late-claim (stock OpenClaw race).
 */
export const INSTRUCTION_OBSERVE_WAIT_MS = 500;
export const INSTRUCTION_OBSERVE_POLL_MS = 25;
/**
 * Verified production attachment roots (bonface-owner Telegram).
 * Runtime still requires WAM_ATTACHMENT_ROOTS to list these (or a test subset).
 */
export const VERIFIED_ATTACHMENT_ROOTS = [
    "/home/bonface/.openclaw/media/inbound",
    "/home/bonface/.openclaw/workspaces/bonface-owner/media/inbound",
];
export const WRAPPER_TOOL_NAMES = [
    "inspect_current_business_document",
    "parse_current_document_customers",
    "reconcile_current_document_customers",
];
export const RAW_DOCUMENT_MCP_PREFIX = "wam.business.documents.";
export const OPENCLAW_VERSION_GUARD = {
    allowedExact: ["2026.7.1", "2026.7.1-1", "2026.7.1-2", "2026.7.2"],
    minPrefix: "2026.7.1",
    maxExclusivePrefix: "2026.8.0",
};
export const REQUIRED_PENDING_CAPTURE_FIELDS = [
    "message_id",
    "account_id",
    "peer_id",
    "sender_id",
    "agent_id",
    "session_key",
    "staged_media_path",
];
/** Claim fields required on stock before_prompt_build (no messageId). */
export const REQUIRED_CLAIM_TURN_FIELDS = [
    "sessionKey",
    "peerId",
    "runId",
];
