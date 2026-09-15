#!/usr/bin/env bash
# Apply Phase 1A + 1A.1 migrations to a disposable local PostgreSQL fixture.
# Usage: ./scripts/apply-disposable-fixture.sh [database_url]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../../.." && pwd)"
DB_URL="${1:-postgresql://postgres:postgres@localhost:5432/wam_ai_fixture}"

echo "Applying disposable stubs..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/disposable-stubs.sql"

for migration in \
  "$REPO_ROOT/admin-dashboard/supabase/migrations/20260827190000_wam_ai_phase1a_reporting.sql" \
  "$REPO_ROOT/admin-dashboard/supabase/migrations/20260827191500_wam_ai_phase1a_public_privilege_hardening.sql" \
  "$REPO_ROOT/admin-dashboard/supabase/migrations/20260828120000_wam_ai_phase1a1_open_book_reporting.sql" \
  "$REPO_ROOT/admin-dashboard/supabase/migrations/20260828140000_wam_ai_phase1a1_agent_registration_performance.sql" \
  "$REPO_ROOT/admin-dashboard/supabase/migrations/20260828160000_wam_ai_phase1a2_lead_agent_recommendations.sql"
do
  echo "Applying $(basename "$migration")..."
  if [[ "$migration" == *phase1a2* ]]; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$migration"
  else
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$migration"
  fi
done

echo "Creating restricted role and explicit function grants..."
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    CREATE ROLE wam_ai_business_readonly LOGIN PASSWORD 'fixture_only' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END;
$r$;
GRANT USAGE ON SCHEMA wam_ai TO wam_ai_business_readonly;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA wam_ai FROM wam_ai_business_readonly;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_operational_summary(timestamptz,timestamptz,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.search_agents(text,text,text,text,text,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_agent_details(uuid,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.search_customers(text,text,text,text,text,text,uuid,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_customer_details(text,uuid,text,text,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.search_leads(text,text,text,text,text,text,text,uuid,text,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_lead_details(uuid,text,text,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_agent_registration_performance(timestamptz,timestamptz,text,uuid,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.record_audit_event(uuid,text,text,text,text,text,text,jsonb,text,integer,text,text,integer,text,boolean) TO wam_ai_business_readonly;
SQL

echo "Running privilege gate..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/privilege-gate.sql"

echo "Smoke: search_agents as restricted role..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "SET ROLE wam_ai_business_readonly; SELECT wam_ai.search_agents('Test', NULL, NULL, NULL, NULL, 5);"

echo "Smoke: get_operational_summary (Phase 1A regression)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "SET ROLE wam_ai_business_readonly; SELECT wam_ai.get_operational_summary(NULL, NULL, NULL);"

echo "Smoke: get_agent_registration_performance (Phase 1A.1 registration attribution)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "SET ROLE wam_ai_business_readonly; SELECT wam_ai.get_agent_registration_performance('2026-08-27T21:00:00Z'::timestamptz, '2026-08-28T20:59:59.999Z'::timestamptz, NULL, NULL, 25);"

echo "Smoke: recommend_agents_for_lead (Phase 1A.2a)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "SET ROLE wam_ai_business_readonly; SELECT wam_ai.recommend_agents_for_lead('77777777-7777-7777-7777-777777777777'::uuid, NULL, 5, false, false, 30);"

echo "fixture_apply_pass"
