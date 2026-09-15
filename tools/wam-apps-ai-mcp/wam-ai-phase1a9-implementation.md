# WAM APPS AI Phase 1A.9 — Semantic business query (implementation)

**Status:** LOCAL implementation complete — **not deployed**  
**MCP package:** `wam-apps-ai-mcp` **v0.1.19**  
**Constraint:** No production apply, no VPS changes, no SMS, no business-data mutation in this phase’s delivery.

---

## 1. Model flow (required)

```
natural-language question
  → (optional) describe_business_query_catalogue / intent clarification
  → model emits structured JSON only
  → MCP Zod + catalogue allowlist validation
  → wam_ai.list_business_records | aggregate_business_metrics (SECURITY DEFINER)
  → parameterized typed SQL (no caller SQL)
  → concise business answer (number_only | summary | detailed)
```

**MCP does not accept natural-language SQL.** The model performs interpretation. Caller keys `sql` / `query` / `rawSql` are rejected at the server boundary and again inside the RPCs.

### When the model must ask for clarification (`ask_user`)

| Situation | Intent / behaviour |
|---|---|
| “Customers scheduled for a visit today” (multi-dataset) | `intent=customers_visit_today` → clarify `customer_registrations` vs `inbound_leads` |
| “Installations in Nairobi last week” | `intent=installations_by_county_period` → clarify dataset + date field (`installed_at` vs `created_at` vs status) |
| Dataset omitted on list/aggregate | Clarify which dataset |
| Ambiguous field / unknown catalogue id | Do **not** guess — return validation error or catalogue |

---

## 2. OpenClaw `toolFilter` namespace

Allow the query namespace (in addition to existing read namespaces as already configured):

```text
wam.business.query.*
```

Exact tools:

- `wam.business.query.describe_business_query_catalogue`
- `wam.business.query.list_business_records`
- `wam.business.query.aggregate_business_metrics`

No mutation tools exist in this namespace.

---

## 3. Examples

### Number-only — “How many agents joined this month?”

```json
{
  "dataset": "agents",
  "metrics": [{ "fn": "count", "field": "id", "alias": "agents_joined" }],
  "filters": [{ "field": "created_at", "op": "relative_range", "value": "this_month" }],
  "response_mode": "number_only"
}
```

Semantics: **joined → `agents.created_at`**, Africa/Nairobi month half-open `[month_start, next_month)`.

### List — “Which registrations have visit_day today?”

```json
{
  "dataset": "customer_registrations",
  "filters": [{ "field": "visit_date", "op": "relative_range", "value": "today" }],
  "select": ["visit_date", "status", "customer_name", "airtel_number"],
  "response_mode": "summary"
}
```

`visit_day` → `visit_date`. TEXT `M/d/yyyy` parsed fail-closed. **`created_at` is never substituted.**

### Aggregate grouped

```json
{
  "dataset": "inbound_leads",
  "metrics": [{ "fn": "count", "field": "id", "alias": "n" }],
  "group_by": ["county", "status"],
  "filters": [{ "field": "created_at", "op": "relative_range", "value": "last_week" }],
  "response_mode": "summary"
}
```

### Clarification (do not guess)

```json
{ "intent": "customers_visit_today" }
```

→ `status: clarification_required` with `ask_user: true`.

---

## 4. Implemented / deferred / rejected

| Item | Status |
|---|---|
| Namespace `wam.business.query` + 3 tools | **Implemented** |
| Datasets: agents, customer_registrations, inbound_leads, safaricom_registrations | **Implemented** |
| Relative dates (today…last_month), Nairobi TZ, half-open ranges | **Implemented** |
| CR `visit_date` TEXT MDY fail-closed | **Implemented** |
| Clarification metadata for ambiguous visit/install questions | **Implemented** |
| `number_only` / summary / detailed | **Implemented** |
| Pagination, totals vs returned rows, deterministic sort | **Implemented** |
| Open-book phones; no internal UUIDs; business refs | **Implemented** |
| Audit shape-only (no row values / phones / names) | **Implemented** |
| SECURITY DEFINER + `wam_ai_business_readonly` EXECUTE; no base SELECT | **Implemented** |
| Joins across datasets | **Rejected** (empty `joins` only; Phase 1A.9) |
| Arbitrary SQL / one-tool-per-question | **Rejected** |
| Notifications / SMS / writes in query namespace | **Rejected** |
| Changing Phase 1A.8 reconcile identity policy | **Rejected** (untouched) |
| `explain_business_query` dry-run tool | **Deferred** |
| notifications / sms_history as query datasets | **Deferred** |
| Production deploy | **Deferred** (explicitly out of scope for this delivery) |

---

## 5. Supported datasets and fields (summary)

See live catalogue via `describe_business_query_catalogue`. Canonical highlights:

| Dataset | Key date fields | Status concepts | Location |
|---|---|---|---|
| `agents` | `created_at` (= joined) | pending / approved / rejected / banned | town, area |
| `customer_registrations` | `visit_date` (TEXT MDY), `created_at` | pending / installed / rejected / … | installation_town |
| `inbound_leads` | `visit_date` (DATE), `installed_at`, `created_at` | assigned / installed / pending_install / … | county, installation_town |
| `safaricom_registrations` | `created_at` only (no visit_date) | pending / installed / rejected / … | install_county, install_town |

---

## 6. SQL migrations

| Order | File |
|---|---|
| After 1A.8 remediation | `20260910120000_wam_ai_phase1a9_semantic_query.sql` |

Mirrored in:

- `admin-dashboard/supabase/migrations/`
- `admin-dashboard/tools/wam-apps-ai-mcp/migrations/`

### Pre / post verifiers

- `scripts/production-verify-phase1a9-pre.sql`
- `scripts/production-verify-phase1a9-post.sql`
- `scripts/disposable-verify-phase1a9.sql`
- Extended `scripts/privilege-gate.sql`

### Rollback

1. Stop MCP processes using v0.1.19 (or leave running but remove query from OpenClaw toolFilter).  
2. `DROP FUNCTION IF EXISTS wam_ai.list_business_records(jsonb);`  
   `DROP FUNCTION IF EXISTS wam_ai.aggregate_business_metrics(jsonb);`  
   `DROP FUNCTION IF EXISTS wam_ai.describe_business_query_catalogue(text);`  
   Drop private `_query_*` helpers.  
3. Redeploy prior MCP package (v0.1.18) if needed.  
4. Re-run Phase 1A.8 post-verify + privilege gate.  

Rollback does **not** require changing 1A.8 reconcile functions.

---

## 7. Security findings and residual risks

| Finding | Severity | Notes |
|---|---|---|
| No arbitrary SQL path from MCP args | Mitigated | Server + RPC double deny |
| Allowlisted field expressions only | Mitigated | CASE-mapped fragments; values parameterized |
| Base-table SELECT not granted to readonly | Mitigated | Privilege gate asserts |
| Actions role cannot EXECUTE query RPCs | Mitigated | REVOKE + gate |
| Audit stores filter **values** | Mitigated in MCP | `redactQueryAuditArgs` stores fields/ops only |
| Dynamic `EXECUTE` inside SECURITY DEFINER | Residual | Fragments are allowlisted; still treat catalogue expansion as security-sensitive |
| CR visit_date invalid rows silently excluded | Residual (by design) | Fail-closed match; operators should know invalid TEXT never matches |
| Catalogue served from TS (SQL catalogue is thinner) | Residual | Disposable/post verify use SQL RPCs; MCP catalogue is richer TS mirror |

---

## 8. Deployment runbook (LOCAL only — do not run against production without separate authorization)

1. Pre-verify: `production-verify-phase1a9-pre.sql`  
2. Apply migration `20260910120000_wam_ai_phase1a9_semantic_query.sql`  
3. Confirm grants to `wam_ai_business_readonly` (migration DO block + fixture grants)  
4. Privilege gate: `privilege-gate.sql`  
5. Post-verify: `production-verify-phase1a9-post.sql` + disposable `disposable-verify-phase1a9.sql`  
6. Deploy MCP **v0.1.19** with existing readonly DB URL  
7. OpenClaw: add `wam.business.query.*` to toolFilter  
8. Smoke: agents joined this month (number_only); visit_day today on CR  

**This delivery does not perform steps 1–8 against production.**

---

## 9. Package artifact

| Field | Value |
|---|---|
| Version | **0.1.19** |
| Archive | `docs/wam-apps-ai-mcp-phase1a9-semantic-query-clean.tar.gz` |
| Size | **503 902** bytes |
| SHA-256 | `ab0c8802000decec561419005636e6ec2ccc9745ded5991912d38098154635bb` |
| Manifest | `docs/PACKAGE-MANIFEST-phase1a9.txt` |
| Disposable validation | `docs/wam-ai-phase1a9-disposable-validation.md` — **LOCAL GO** |

---

## 10. Test results (this workspace)

| Suite | Result |
|---|---|
| Unit (`npm test`) | **509/509 passed** (includes Phase 1A.3–1A.8 regressions + 1A.9) |
| Typecheck | **pass** |
| Disposable SQL / integration | Scripts added; run when fixture DB available (`npm run test:integration`) — **not executed against production** |

---

## 11. LOCAL GO / NO-GO

**LOCAL GO** for package v0.1.19 **subject to**:

- Disposable DB apply + `disposable-verify-phase1a9.sql` + privilege gate before any future production authorization  
- No production connection was made as part of this delivery  

NO-GO conditions checked in unit/packaging:

- Arbitrary SQL reachable → **no** (rejected)  
- visit_date vs created_at confusion → **guarded** (aliases + fail-closed parse + clarification)  
- Ambiguous questions guessed → **no** (clarification_required)  
- Privilege gates encoded → **yes** (SQL scripts)  
- Audit business values → **redacted in MCP audit args**  
- Regressions → **509 unit tests green**
