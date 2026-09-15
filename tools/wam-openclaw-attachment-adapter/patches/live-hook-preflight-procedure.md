# Live-hook preflight procedure (adapter v0.1.2)

Use installable plugin `wam-openclaw-live-hook-preflight@0.1.1`.

PASS (two-message):
- `message_received`: messageId, sessionKey, accountId, peerId, senderId +
  qualifying_media_present + staged_media_path_present; not media_staging_pending
- `before_prompt_build` / `before_tool_call`: sessionKey, peerId, runId

Does not require update_id, file_unique_id, or runId on message_received.

Logs: field names / boolean presence only — never paths, IDs, or content.
