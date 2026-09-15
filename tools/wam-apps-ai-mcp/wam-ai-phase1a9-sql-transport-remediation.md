# Phase 1A.9 SQL transport remediation (EXECUTE USING / JSONB binds)

**Package:** wam-apps-ai-mcp **v0.1.20**  
**Verdict:** **LOCAL GO**  
**Constraint:** No production / VPS / SMS / business-data changes.

## Problem

`EXECUTE … USING VARIADIC` is invalid in PostgreSQL. The interim `format(%L)` path interpolated user-derived filter values into SQL text — rejected for Phase 1A.9.

## Fix

`_query_apply_filters` now:

1. Appends every user-derived (and server-computed relative-bound) value into a JSONB array `v_binds`.
2. Emits WHERE fragments that reference **only** `($1->>N)` / `($1->N)` with typed casts.
3. Callers run `EXECUTE … USING v_binds` (single JSONB parameter). No VARIADIC. No `%L`. No `quote_literal`.

## Remaining `format()` uses (all trusted)

| Pattern | Classification | Why trusted |
|---|---|---|
| `format('… %s …', v_expr, …)` | allowlisted expression | `v_expr` from `_query_resolve_field_expr` CASE only |
| `format('… ($1->>%s) …', …, v_idx)` | structural bind index | Integer from `jsonb_array_length` (0..N), not user text |
| `format('… AS %I', …, v_field)` | identifier | Field already allowlisted; `%I` quotes identifier |
| `format('… %s NULLS LAST', v_expr, v_dir)` | expression + dir | `v_dir` ∈ {asc,desc} only |
| `format('… LIMIT %s OFFSET %s', …, v_limit, v_offset)` | structural ints | Clamped integers from request |
| `format('count(%s.id)', v_alias)` etc. | allowlisted alias | Fixed dataset alias `a`/`cr`/`l`/`sr` |
| Fixed SQL strings without user values | structural | e.g. CR visit_date select projection |

**Proof no user value enters SQL text:** disposable verifier asserts hostile payloads are absent from `out_sql` and present only in `out_binds->>0`; function body has no `%L`.

## Commands & exit codes (fresh `wam_ai_fixture_1a9`)

| Step | Exit |
|---|---|
| dropdb / createdb | 0 / 0 |
| `apply-disposable-fixture.ps1` (`fixture_apply_pass`, includes 1A.8 + 1A.9 verify) | **0** |
| `privilege-gate.sql` | **0** |
| `action-privilege-gate.sql` | **0** |
| `disposable-privilege-matrix-phase1a9.sql` | **0** |
| 1A.8 verify (after truncate sessions + fixture) | **0** |
| `npm run typecheck` / `build` | **0** / **0** |
| `npm test` | **0** (**513/513**) |
| `phase1a9-query.integration.test.ts` | **0** (**1/1**, not skipped) |

## Test totals

- Unit: **513 passed** (includes `phase1a9-sql-transport.test.ts`)
- Integration 1A.9: **1 passed**
- Disposable 1A.9: `phase1a9_disposable_verify_pass`
- Disposable 1A.8: `disposable_verify_phase1a8_pass`

## Package

| Field | Value |
|---|---|
| Version | **0.1.20** |
| Archive | `docs/wam-apps-ai-mcp-phase1a9-semantic-query-clean.tar.gz` |
| Size | **505 007** bytes |
| SHA-256 | `f311f4ec5b209c524845d464fd1f93e0ba293926e4876794fcc26e2561593416` |

## LOCAL GO / NO-GO

**LOCAL GO** — user-derived values are bound via `EXECUTE … USING` JSONB `$1`; no `format(%L)` remains in the migration.
