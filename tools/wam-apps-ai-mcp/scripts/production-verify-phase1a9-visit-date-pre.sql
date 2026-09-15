-- Phase 1A.9.1 visit_date dual-format production pre-verify
-- Run before applying 20260912120000_wam_ai_phase1a9_visit_date_dual_format.sql
-- Safe read-only checks; does not mutate business data.

DO $v$
DECLARE
  v_iso_count bigint;
  v_mdy_count bigint;
  v_nonempty bigint;
BEGIN
  IF to_regprocedure('wam_ai.list_business_records(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'phase1a9_visit_pre_fail: Phase 1A.9 list_business_records missing (apply 1A.9 first)';
  END IF;
  IF to_regprocedure('wam_ai._query_parse_mdy_date(text)') IS NULL THEN
    RAISE EXCEPTION 'phase1a9_visit_pre_fail: missing _query_parse_mdy_date';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    RAISE EXCEPTION 'phase1a9_visit_pre_fail: missing wam_ai_business_readonly';
  END IF;
  IF to_regclass('public.customer_registrations') IS NULL THEN
    RAISE EXCEPTION 'phase1a9_visit_pre_fail: missing customer_registrations';
  END IF;

  -- Evidence snapshot (read-only): format distribution among non-empty visit_date
  SELECT count(*) INTO v_nonempty
  FROM public.customer_registrations
  WHERE visit_date IS NOT NULL AND btrim(visit_date) <> '';

  SELECT count(*) INTO v_iso_count
  FROM public.customer_registrations
  WHERE visit_date IS NOT NULL AND btrim(visit_date) ~ '^\d{4}-\d{2}-\d{2}$';

  SELECT count(*) INTO v_mdy_count
  FROM public.customer_registrations
  WHERE visit_date IS NOT NULL AND btrim(visit_date) ~ '^\d{1,2}/\d{1,2}/\d{4}$';

  RAISE NOTICE 'phase1a9_visit_pre: nonempty=% iso_shaped=% mdy_shaped=%',
    v_nonempty, v_iso_count, v_mdy_count;
  RAISE NOTICE 'phase1a9_visit_date_dual_format_pre_verify_pass';
END;
$v$;
