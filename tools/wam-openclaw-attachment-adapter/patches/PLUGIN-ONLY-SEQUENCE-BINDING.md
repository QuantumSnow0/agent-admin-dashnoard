# Plugin-only sequence binding (v0.2.2) — ACCEPTED

## Verdict

**ACCEPTED** for the private `bonface-owner` Telegram session on stock
OpenClaw **2026.7.1-2**. No OpenClaw core patch. No `OPENCLAW_WAM_CORE_PATCH`.

## Binding semantics

1. Qualifying CSV/XLSX `message_received` → pending.
2. Next same-identity text `message_received` → `instruction_observed`.
3. Pathless wrappers are **always catalogued** (alsoAllow permitting).
4. If instruction prompt/tool catalogue races ahead of async observe, wrapper
   execute waits ≤500 ms then late-claims with `sessionKey + peerId + runId`.
5. Sequence binding only — not cryptographic message-to-prompt binding.

## Residual risk

Without `messageId` on `before_prompt_build`, delayed/out-of-order prompts
cannot be proven to match the instruction message. Fail-closed rules reduce
but do not eliminate that risk. On this VPS, leaving `plugins.allow` absent
accepts OpenClaw’s non-bundled-plugin trust warning (narrow allow suppresses
bundled plugins on 2026.7.1-2).

