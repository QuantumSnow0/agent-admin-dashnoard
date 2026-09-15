-- Phase 1A.9 production post-verify (privilege + RPC presence)
-- Safe to run after migration; does not mutate business data.

DO $v$
DECLARE
  v_role text := 'wam_ai_business_readonly';
BEGIN
  IF to_regprocedure('wam_ai.list_business_records(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'phase1a9_post_fail: missing list_business_records';
  END IF;
  IF to_regprocedure('wam_ai.aggregate_business_metrics(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'phase1a9_post_fail: missing aggregate_business_metrics';
  END IF;
  IF to_regprocedure('wam_ai.describe_business_query_catalogue(text)') IS NULL THEN
    RAISE EXCEPTION 'phase1a9_post_fail: missing describe_business_query_catalogue';
  END IF;

  IF NOT has_function_privilege(v_role, 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'phase1a9_post_fail: readonly missing EXECUTE on list_business_records';
  END IF;
  IF NOT has_function_privilege(v_role, 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'phase1a9_post_fail: readonly missing EXECUTE on aggregate_business_metrics';
  END IF;

  IF has_table_privilege(v_role, 'public.agents', 'SELECT')
     OR has_table_privilege(v_role, 'public.inbound_leads', 'SELECT')
     OR has_table_privilege(v_role, 'public.customer_registrations', 'SELECT')
     OR has_table_privilege(v_role, 'public.safaricom_registrations', 'SELECT') THEN
    RAISE EXCEPTION 'phase1a9_post_fail: readonly has base-table SELECT';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    IF has_function_privilege('wam_ai_business_actions', 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'phase1a9_post_fail: actions can EXECUTE list_business_records';
    END IF;
  END IF;

  IF has_function_privilege('public', 'wam_ai.list_business_records(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'wam_ai.list_business_records(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'phase1a9_post_fail: public/anon/authenticated can EXECUTE query RPC';
  END IF;

  -- Helpers must not be independently executable by readonly
  IF has_function_privilege(v_role, 'wam_ai._query_parse_mdy_date(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'phase1a9_post_fail: readonly can EXECUTE _query_parse_mdy_date';
  END IF;

  RAISE NOTICE 'phase1a9_production_post_verify_pass';
END;
$v$;
