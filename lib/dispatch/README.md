# Lead dispatch (v1)

Inbound leads from marketing websites are matched to the **nearest available agent within the customer's county**, offered one agent at a time, and tracked through KYC and install proof.

---

## Which Supabase project? (read this first)

This monorepo has **three separate Supabase projects**. Dispatch lives in only one.

| Repo / app | Supabase project | Project ref (yours) | Role |
|------------|------------------|---------------------|------|
| **`admin-dashboard`** | **Agent hub** | `olaounggwgxpbenmuvnl` | SQL migrations, edge functions, admin UI, `agents`, `inbound_leads` |
| **`airtel-agent-app`** | **Agent hub** (same) | `olaounggwgxpbenmuvnl` | Agent mobile app — same DB as dashboard |
| **`airtel`** (airtel5grouter.co.ke) | **Website DB** (separate) | *your airtel site project* | Local `leads` backup only — **no dispatch SQL here** |
| **`kenya-internet`** (internetkenya.co.ke) | **Website DB** (separate) | *your kenya-internet project* | Local `leads` backup only — **no dispatch SQL here** |

**Rule:** Run dispatch **SQL**, **secrets**, and **edge function deploys** only on the **agent hub** project (`olaounggwgxpbenmuvnl`).  
Websites only **HTTP POST** to that project’s `create-inbound-lead` function (Phase 3).

Dashboard URL: https://supabase.com/dashboard/project/olaounggwgxpbenmuvnl

---

## Deploy checklist (agent hub only)

### 1. SQL migration

- **Where:** Supabase Dashboard → project **olaounggwgxpbenmuvnl** → SQL Editor  
- **Or CLI** (from `admin-dashboard/`, linked to agent hub):

```bash
cd admin-dashboard
supabase link --project-ref olaounggwgxpbenmuvnl
supabase db push
```

- **File:** `admin-dashboard/supabase/migrations/20260711140000_lead_dispatch_v1.sql`

### 2. Edge Function secret

- **Where:** Supabase Dashboard → **olaounggwgxpbenmuvnl** → Project Settings → Edge Functions → Secrets  
- **Add:** `INBOUND_LEAD_API_KEY` = long random string (save for website Vercel env in Phase 3)

### 3. Deploy edge functions

- **Where:** deploy **to agent hub** (`olaounggwgxpbenmuvnl`), not website projects  

```bash
cd admin-dashboard
supabase link --project-ref olaounggwgxpbenmuvnl
supabase functions deploy create-inbound-lead
supabase functions deploy dispatch-lead
supabase functions deploy lead-offer-action
supabase functions deploy lead-outcome
```

- **Source code lives in:** `admin-dashboard/supabase/functions/`  
- **Called by:** websites (API key) + agent app (JWT) → same agent hub URLs

### 4. Vercel (Phase 3 — both marketing sites)

Add to **airtel** and **kenya-internet** Vercel env (not agent hub):

| Variable | Value |
|----------|--------|
| `AGENT_SUPABASE_URL` | `https://olaounggwgxpbenmuvnl.supabase.co` |
| `INBOUND_LEAD_API_KEY` | same secret as step 2 |

Websites keep their **own** Supabase for local lead storage; they additionally POST to agent hub.

### 5. What NOT to run on website Supabase projects

- Do **not** run `20260711140000_lead_dispatch_v1.sql` on airtel or kenya-internet DBs  
- Do **not** deploy dispatch edge functions to website projects  
- MS Forms / local `leads` tables on those sites stay as-is until Phase 3 wiring

---

## Scope (v1)

| In scope | Out of scope (future) |
|----------|------------------------|
| `airtel5grouter` + `internetkenya` sources | GPS live location |
| Airtel + Safaricom products | Savanna / VGG |
| Blind offer → accept → full PII | Airtel Connect deeplink return |
| Agent outcomes + SR / IMEI on install | Auto MS Forms |
| Admin queue when no county coverage | Historical lead import |

## Tables

- `dispatch_config` — global timeouts and limits
- `location_reference` — town → county + centroid
- `agent_dispatch_settings` — availability toggle per agent
- `agents.lead_dispatch_scope` — `both` \| `airtel` \| `safaricom` \| `none`
- `inbound_leads` — lead lifecycle + proof fields
- `lead_offers` — blind preview before accept

## Edge functions

| Function | Auth | Purpose |
|----------|------|---------|
| `create-inbound-lead` | `x-inbound-api-key` | Websites POST new leads |
| `dispatch-lead` | service / internal | Match county + nearest agent |
| `lead-offer-action` | agent JWT | Accept / decline offer |
| `lead-outcome` | agent JWT | KYC + installed + proof |

## Extending v1

- Add towns: insert into `location_reference`
- New statuses: `ALTER TABLE ... DROP CONSTRAINT` + add value (document in new migration)
- New notification types: extend `notifications_type_check`
- Extra fields: prefer `metadata` JSONB first, promote to columns when stable

## Env (websites → agent hub only)

Set on **Vercel** for `airtel` and `kenya-internet` (Phase 3):

```
AGENT_SUPABASE_URL=https://olaounggwgxpbenmuvnl.supabase.co
INBOUND_LEAD_API_KEY=<same-as-agent-hub-edge-secret>
```

Set on **agent hub** Supabase → Edge Function secrets:

```
INBOUND_LEAD_API_KEY=<same-value>
```
