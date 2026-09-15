# Phase 1A.9 visit_date dual-format remediation (v0.1.21)

**Status:** Local remediation package only — do not deploy without separate authorization.  
**Package:** `wam-apps-ai-mcp@0.1.21`  
**Migration:** `20260912120000_wam_ai_phase1a9_visit_date_dual_format.sql` (forward-only)

## Root cause

Phase 1A.9 / MCP **v0.1.20** parsed `public.customer_registrations.visit_date` (TEXT) as **M/d/yyyy only**. Production evidence showed all non-empty values are **ISO YYYY-MM-DD**. Fail-closed MDY parsing therefore treated every production visit_date as invalid → relative filters (`visit_day` / today / this_week / etc.) returned **false zero counts**. Phase 1A.8 behavior was unrelated and remains unchanged. OpenClaw containment removed `wam.business.query.*` from the MCP filter while leaving the 1A.9 SQL and v0.1.20 runtime active for other namespaces.

## Exact parsing semantics

| Rule | Behavior |
|------|----------|
| Whitespace | Leading/trailing whitespace trimmed (`btrim` / `trim`). Empty after trim → NULL. Internal whitespace → NULL. |
| MDY | `^\d{1,2}/\d{1,2}/\d{4}$` — one- or two-digit month/day, 4-digit year |
| ISO | `^\d{4}-\d{2}-\d{2}$` — exact zero-padded widths only (`2026-9-10` rejected) |
| Calendar | `make_date` + year/month/day round-trip; impossible dates (e.g. `2/30/2026`, `2026-02-30`) → NULL |
| Silent normalize | Never use `::date` / `to_date` for this TEXT column |
| Match policy | NULL parse → row does not match visit_date filters (fail-closed) |
| Substitution | **Never** substitute `created_at` when `visit_date` / `visit_day` was requested |
| Transport | Unchanged: `EXECUTE … USING` JSONB `$1` binds; no `%L`, `quote_literal`, `USING VARIADIC` |

## Implemented / deferred / rejected

| Item | Decision |
|------|----------|
| Dual-format MDY + ISO parser (forward migration) | **Implemented** |
| MCP bump to v0.1.21 | **Implemented** |
| Preserve JSONB bind transport + privilege boundaries | **Implemented** |
| Disposable fixture mixed + ISO-only prod-shaped cohort | **Implemented** |
| `next_week` relative period | **Deferred** (not in allowlist; validation/SQL reject) |
| Rewrite historical visit_date TEXT to a single storage format | **Rejected** (read-path dual parse only) |
| Re-apply original `20260910120000` on production | **Rejected** |
| Manual production UPDATE of visit_date values | **Rejected** |
| Accept unpadded ISO / hybrid separators | **Rejected** (fail-closed) |

## Files

- Migration (mirrored): `migrations/` + `admin-dashboard/supabase/migrations/`
- Pre/post: `scripts/production-verify-phase1a9-visit-date-{pre,post}.sql`
- Fixture/verify: `scripts/disposable-fixture-phase1a9.sql`, `disposable-verify-phase1a9.sql`
- Runbook: `wam-ai-phase1a9-deployment-runbook.md` (current production containment state)
