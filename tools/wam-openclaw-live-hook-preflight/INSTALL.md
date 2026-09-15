# WAM Live-Hook Preflight — Install / Verify / Rollback (OpenClaw 2026.7.1-2)

**Plugin id:** `wam-live-hook-preflight`  
**Version:** 0.1.2  
**Scope:** read-only presence probes aligned with adapter **v0.1.3**  
**Non-goals:** no attachment capture, no MCP bridge, no tools, no database access  

Production must not be enabled without separate explicit approval.

---

## PASS criteria (two-message design)

### File turn — `message_received`

Must be scalar-present: `messageId`, `sessionKey`, `accountId`, `peerId`, `senderId`  
Media flags: `qualifying_media_present`, `staged_media_path_present`; not `media_staging_pending`

The first qualifying file snapshot is **preserved** across subsequent text-only `message_received` events (text must not overwrite the PASS basis).

### Instruction hooks — `before_prompt_build` / `before_tool_call`

Must be scalar-present: `sessionKey`, `peerId`, `runId`  
(Does not require messageId / accountId / senderId.)

Logs: field **names** only.

---

## Install

```bash
cd admin-dashboard/tools/wam-openclaw-live-hook-preflight
npm ci && npm test && npm run build && npm pack
# → wam-openclaw-live-hook-preflight-0.1.2.tgz
openclaw plugins install npm-pack:./wam-openclaw-live-hook-preflight-0.1.2.tgz --force
```

Env: `OPENCLAW_VERSION=2026.7.1-2` and `WAM_LIVE_HOOK_PREFLIGHT_ENABLED=1`
