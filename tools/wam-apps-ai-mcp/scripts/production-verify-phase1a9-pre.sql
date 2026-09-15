-- Phase 1A.9 production pre-verify (before applying migration)
DO $v$
BEGIN
  IF to_regprocedure('wam_ai.list_business_records(jsonb)') IS NOT NULL THEN
    RAISE NOTICE 'phase1a9_pre: list_business_records already present (re-apply / upgrade path)';
  ELSE
    RAISE NOTICE 'phase1a9_pre: list_business_records absent (clean apply path)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    RAISE EXCEPTION 'phase1a9_pre_fail: missing wam_ai_business_readonly';
  END IF;
  IF to_regclass('public.agents') IS NULL
     OR to_regclass('public.customer_registrations') IS NULL
     OR to_regclass('public.inbound_leads') IS NULL
     OR to_regclass('public.safaricom_registrations') IS NULL THEN
    RAISE EXCEPTION 'phase1a9_pre_fail: missing required base tables';
  END IF;
  RAISE NOTICE 'phase1a9_production_pre_verify_pass';
END;
$v$;
