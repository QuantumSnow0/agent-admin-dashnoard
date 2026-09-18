# WAM APPS AI — business_partner ops authorization remediation (v0.1.22)

**Package:** `wam-apps-ai-mcp@0.1.22`  
**Migration:** `20260912180000_wam_ai_business_partner_ops_authorization.sql`  
**Scope:** Local packaging only — do **not** deploy, connect production, mutate Hub data, change OpenClaw, send SMS, or restart services from this remediation alone.

## Exact authorization changes

| Layer | Change |
|---|---|
| MCP `tools-actions.ts` | Removed `set_agent_fallback_dispatch` / `set_agent_service_radius` from `TECHNICAL_OWNER_ONLY_ACTIONS` (set now empty). Both use shared open-book gateway auth (`technical_owner` \| `business_partner`). |
| MCP `tools-sms.ts` | `isSmsSendAuthorized` now allows the same gateway roles as SMS read (not `technical_owner` alone). Actor identity still taken only from verified instance actor context. |
| SQL remediation | `CREATE OR REPLACE` for `set_agent_fallback_dispatch`, `set_agent_service_radius`, `prepare_send_agent_sms`, `finalize_send_agent_sms` — role gate is `NOT IN ('technical_owner','business_partner')` deny. Finalize still binds correlation/actor_id/actor_role to reservation and audits from reservation identity. |

## Implemented / deferred / rejected

| Item | Status |
|---|---|
| Allow BP: fallback, radius, SMS send | **Implemented** |
| Preserve technical_owner on all three | **Implemented** |
| Deny unknown / ai_service / system_maintenance | **Implemented** (unchanged fail-closed) |
| Keep SMS safety (exact body, fingerprint, Agent Hub only, no broadcast, no arbitrary MSISDN) | **Implemented** (unchanged) |
| Actor audit as business_partner (no impersonation as technical_owner/Bonface) | **Implemented** |
| Add code/shell/fs/SQL/deploy/OpenClaw/server tools to BP | **Rejected** |
| Production apply / real SMS / OpenClaw restart | **Deferred** (requires separate explicit authorization) |

## business_partner capability matrix (post-remediation)

### Allowed (existing + newly authorized)

1. Read/query supported WAM business information (open-book phones)
2. Documents / parse / reconciliation
3. Agent approve/reject/ban/restore + pending
4. Airtel/Safaricom registration manage + reopen
5. Inbound leads + install confirm (financial gates unchanged)
6. Normal agent dispatch scope
7. **NEW:** `set_agent_fallback_dispatch`
8. **NEW:** `set_agent_service_radius`
9. Financial/ops actions already gated by switches
10. In-app notifications inspect/send
11. SMS inspect + **NEW:** single-recipient `send_agent_sms` (safe workflow)

### Denied (unchanged)

- Source/coding tools, shell, filesystem, raw SQL/DB admin
- Deployments/migrations tooling, credentials/secrets/env files
- OpenClaw config, plugin/agent admin, Telegram pairing admin
- VPS/systemd/server admin
- Airtel/Kenya Internet force-unavailable
- WAM Apps super-admin capabilities
- Arbitrary-recipient or broadcast messaging

## Local verification evidence (fixtures/mocks only)

- Unit: see test run totals in packaging notes
- `phase1a5.test.ts`: BP + technical_owner allowed for fallback/radius; `ai_service` denied
- `phase1a6.test.ts`: BP SMS send allowed with mock provider; actor args are `business_partner`; `ai_service` denied; explicit_action / arbitrary phone / broadcast still blocked
- Packaging: `phase1a22-bp-ops-auth-packaging.test.ts` + updated 1A.6/1A.9 packaging assertions
- Integration: Phase 1A.8/1A.9 integration suites (unchanged behaviour)

## Deploy / rollback (when separately authorized)

1. Pre-verify action privilege gates (read-only).
2. Apply **only** `20260912180000_wam_ai_business_partner_ops_authorization.sql`.
3. Post-verify disposable 1A.5/1A.6 scripts (partner allowed; ai_service denied).
4. Install MCP **v0.1.22** and restart the MCP process only when authorized.
5. Rollback MCP pin to **v0.1.21** if needed; SQL role gates remain BP-capable until a separate SQL undo is authorized (not packaged).

## LOCAL GO/NO-GO criteria

LOCAL GO only if: no safety control weakened, no real SMS, no production touch, role spoofing impossible via tool args, technical capabilities remain unreachable, and unit/integration/packaging/build pass.
