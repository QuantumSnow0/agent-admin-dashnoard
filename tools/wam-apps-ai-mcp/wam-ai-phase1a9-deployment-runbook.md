# Phase 1A.9 deployment & rollback runbook (v0.1.21 visit_date remediation)

**Package:** wam-apps-ai-mcp **v0.1.21**  
**Archive:** `docs/wam-apps-ai-mcp-phase1a9-visit-date-remediation-clean.tar.gz`  
**SHA-256:** see sibling `.sha256` sidecar  
**Do not apply to production without a separate explicit authorization.**

## Current production state (as of remediation packaging)

| Fact | State |
|------|--------|
| Phase 1A.9 SQL (`20260910120000`) | **Already installed** |
| MCP runtime | **v0.1.20 still active** for existing namespaces |
| `wam.business.query.*` in OpenClaw toolFilter | **Disabled** (containment after false-zero visit_date counts) |
| Phase 1A.8 | Must remain unchanged |

## Dependencies

- Phase 1A.9 semantic query migration already applied
- Roles `wam_ai_business_readonly` / `wam_ai_business_actions`
- Base table `public.customer_registrations.visit_date` TEXT

## Authorized deploy sequence (when approved)

1. Keep `wam.business.query.*` **disabled** in OpenClaw until step 6.
2. Run `production-verify-phase1a9-visit-date-pre.sql` (read-only format distribution notice).
3. Apply **only** `20260912120000_wam_ai_phase1a9_visit_date_dual_format.sql`  
   — do **not** re-apply `20260910120000`.
4. Run `production-verify-phase1a9-visit-date-post.sql` + `production-verify-phase1a9-post.sql` + `privilege-gate.sql` + `disposable-privilege-matrix-phase1a9.sql` (matrix may be adapted for Hub).
5. Install/switch MCP package to **v0.1.21**; restart OpenClaw MCP process for this server.
6. **Read-only** production smoke: confirm visit_day today / this_week / last_week counts are non-absurd and ISO rows match (no writes).
7. Only after step 6 passes: re-enable `wam.business.query.*` in the OpenClaw MCP filter.

## Rollback

1. Immediately remove `wam.business.query.*` from OpenClaw toolFilter (return to containment).
2. Optionally pin MCP runtime back to v0.1.20 (parser still dual-format if remediation SQL remains — that is OK and preferred).
3. Do **not** drop Phase 1A.9 list/aggregate RPCs unless a full 1A.9 undo is separately authorized.
4. Do **not** roll back Phase 1A.8 reconcile semantics.
5. SQL undo of the parser (reintroduce MDY-only) is **not recommended**; prefer filter disable.

## Privilege gates (unchanged summary)

| Principal | list/aggregate/catalogue EXECUTE | public base SELECT |
|---|---|---|
| `wam_ai_business_readonly` | yes | no |
| `wam_ai_business_actions` | no | n/a |
| `anon` / `authenticated` / `PUBLIC` | no | — |

Query namespace exposes **no** mutation tools.
