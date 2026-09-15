# WAM OpenClaw Live-Hook Preflight

Read-only OpenClaw **2026.7.1-2** plugin that registers only:

- `message_received`
- `before_prompt_build`
- `before_tool_call`

**Does not:** capture attachments, open an MCP bridge, register tools, or access a database.

**Requires:** `WAM_LIVE_HOOK_PREFLIGHT_ENABLED=1` and `OPENCLAW_VERSION=2026.7.1-2` (fail closed otherwise).

Logs **field names / presence only**. PASS requires every adapter-capture identity field to be scalar-present (non-empty string or finite number) on all three hooks — documenting absence is not a PASS.

See **INSTALL.md** for exact install, verification, log inspection, disable, uninstall, and rollback commands.
