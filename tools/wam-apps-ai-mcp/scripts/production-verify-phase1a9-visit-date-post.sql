-- Phase 1A.9.1 visit_date dual-format production post-verify
-- Run after 20260912120000; read-only functional checks (no business mutations).

DO $v$
DECLARE
  v_role text := 'wam_ai_business_readonly';
  v_d date;
  v_cat jsonb;
  v_def text;
BEGIN
  -- Parser dual-format + fail-closed
  v_d := wam_ai._query_parse_mdy_date('9/10/2026');
  IF v_d IS DISTINCT FROM DATE '2026-09-10' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: MDY parse';
  END IF;
  v_d := wam_ai._query_parse_mdy_date('09/10/2026');
  IF v_d IS DISTINCT FROM DATE '2026-09-10' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: zero-padded MDY parse';
  END IF;
  v_d := wam_ai._query_parse_mdy_date('2026-09-10');
  IF v_d IS DISTINCT FROM DATE '2026-09-10' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: ISO parse';
  END IF;
  v_d := wam_ai._query_parse_mdy_date('  2026-09-10  ');
  IF v_d IS DISTINCT FROM DATE '2026-09-10' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: trimmed ISO whitespace';
  END IF;
  IF wam_ai._query_parse_mdy_date('2026-02-30') IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: impossible ISO must be null';
  END IF;
  IF wam_ai._query_parse_mdy_date('2/30/2026') IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: impossible MDY must be null';
  END IF;
  IF wam_ai._query_parse_mdy_date('2026-9-10') IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: unpadded ISO must be null';
  END IF;
  IF wam_ai._query_parse_mdy_date('02/29/2024') IS DISTINCT FROM DATE '2024-02-29' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: leap day valid';
  END IF;
  IF wam_ai._query_parse_mdy_date('2024-02-29') IS DISTINCT FROM DATE '2024-02-29' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: leap day ISO valid';
  END IF;
  IF wam_ai._query_parse_mdy_date('02/29/2025') IS NOT NULL
     OR wam_ai._query_parse_mdy_date('2025-02-29') IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: non-leap Feb 29 must be null';
  END IF;

  -- Field expression still visit_date parser (never created_at)
  IF wam_ai._query_resolve_field_expr('customer_registrations', 'visit_date', true)
     IS DISTINCT FROM 'wam_ai._query_parse_mdy_date(cr.visit_date)' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: CR visit_date expr changed unexpectedly';
  END IF;
  IF wam_ai._query_resolve_field_expr('agents', 'created_at', true)
     IS DISTINCT FROM 'a.created_at' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: agents created_at expr';
  END IF;

  v_cat := wam_ai.describe_business_query_catalogue(NULL);
  IF v_cat->>'catalogue_version' IS DISTINCT FROM '1a9.2' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: catalogue_version %', v_cat->>'catalogue_version';
  END IF;

  -- Transport invariants preserved
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'wam_ai' AND p.proname = '_query_apply_filters'
  LIMIT 1;
  IF v_def LIKE '%\%L%' OR v_def ILIKE '%quote_literal%' OR v_def ILIKE '%USING VARIADIC%' THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: forbidden transport pattern in _query_apply_filters';
  END IF;

  IF NOT has_function_privilege(v_role, 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: readonly missing list EXECUTE';
  END IF;
  IF has_function_privilege(v_role, 'wam_ai._query_parse_mdy_date(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: readonly can EXECUTE helper';
  END IF;
  IF has_table_privilege(v_role, 'public.customer_registrations', 'SELECT') THEN
    RAISE EXCEPTION 'phase1a9_visit_post_fail: readonly has base SELECT';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    IF has_function_privilege('wam_ai_business_actions', 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
      RAISE EXCEPTION 'phase1a9_visit_post_fail: actions can EXECUTE list';
    END IF;
  END IF;

  RAISE NOTICE 'phase1a9_visit_date_dual_format_post_verify_pass';
END;
$v$;
