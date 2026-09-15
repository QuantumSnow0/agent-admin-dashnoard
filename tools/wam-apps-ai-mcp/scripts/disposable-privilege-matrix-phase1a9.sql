-- Phase 1A.9 explicit privilege matrix (disposable)
DO $m$
DECLARE
  v_ro text := 'wam_ai_business_readonly';
  v_act text := 'wam_ai_business_actions';
BEGIN
  IF NOT has_function_privilege(v_ro, 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'matrix_fail: readonly missing list EXECUTE';
  END IF;
  IF NOT has_function_privilege(v_ro, 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'matrix_fail: readonly missing aggregate EXECUTE';
  END IF;
  IF NOT has_function_privilege(v_ro, 'wam_ai.describe_business_query_catalogue(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'matrix_fail: readonly missing catalogue EXECUTE';
  END IF;

  IF has_table_privilege(v_ro, 'public.agents', 'SELECT')
     OR has_table_privilege(v_ro, 'public.inbound_leads', 'SELECT')
     OR has_table_privilege(v_ro, 'public.customer_registrations', 'SELECT')
     OR has_table_privilege(v_ro, 'public.safaricom_registrations', 'SELECT') THEN
    RAISE EXCEPTION 'matrix_fail: readonly has base SELECT';
  END IF;

  IF has_function_privilege(v_act, 'wam_ai.list_business_records(jsonb)', 'EXECUTE')
     OR has_function_privilege(v_act, 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE')
     OR has_function_privilege(v_act, 'wam_ai.describe_business_query_catalogue(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'matrix_fail: actions can EXECUTE query RPCs';
  END IF;

  IF has_function_privilege('public', 'wam_ai.list_business_records(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'wam_ai.list_business_records(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'wam_ai.list_business_records(jsonb)', 'EXECUTE')
     OR has_function_privilege('public', 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE')
     OR has_function_privilege('public', 'wam_ai.describe_business_query_catalogue(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'wam_ai.describe_business_query_catalogue(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'wam_ai.describe_business_query_catalogue(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'matrix_fail: PUBLIC/anon/authenticated can EXECUTE query RPCs';
  END IF;

  IF has_function_privilege(v_ro, 'wam_ai._query_parse_mdy_date(text)', 'EXECUTE')
     OR has_function_privilege(v_ro, 'wam_ai._query_apply_filters(text,jsonb,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'matrix_fail: readonly can EXECUTE private query helpers';
  END IF;

  RAISE NOTICE 'phase1a9_privilege_matrix_pass';
END;
$m$;
