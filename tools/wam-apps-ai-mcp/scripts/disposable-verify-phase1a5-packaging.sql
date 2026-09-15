-- Phase 1A.5 packaging-defect regression (disposable fixture only)
-- Proves financial hardening restores wam_ai_business_actions EXECUTE after DROP+CREATE
-- ACL reset, and strips PUBLIC/anon/authenticated/readonly.
\set ON_ERROR_STOP on

\echo '=== simulate lost actions grant + PUBLIC default after DROP+CREATE ==='
REVOKE ALL ON FUNCTION wam_ai.mark_lead_kyc_completed(uuid, text, uuid, uuid, text, text, text, text)
  FROM wam_ai_business_actions;
REVOKE ALL ON FUNCTION wam_ai.mark_lead_pending_install(uuid, text, uuid, uuid, text, text, text, text)
  FROM wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_lead_kyc_completed(uuid, text, uuid, uuid, text, text, text, text)
  TO PUBLIC;
GRANT EXECUTE ON FUNCTION wam_ai.mark_lead_pending_install(uuid, text, uuid, uuid, text, text, text, text)
  TO PUBLIC;

\echo '=== re-apply financial-hardening privilege restore (same as migration) ==='
REVOKE ALL ON FUNCTION wam_ai.mark_lead_kyc_completed(uuid, text, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.mark_lead_pending_install(uuid, text, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN ('mark_lead_kyc_completed', 'mark_lead_pending_install')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO wam_ai_business_actions', r.sig);
    END IF;
  END LOOP;
END;
$priv$;

\echo '=== assert mark_lead_* ACL after restore ==='
DO $$
DECLARE
  v_sigs text[] := ARRAY[
    'wam_ai.mark_lead_kyc_completed(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.mark_lead_pending_install(uuid,text,uuid,uuid,text,text,text,text)'
  ];
  v_sig text;
  v_oid oid;
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'missing %', v_sig;
    END IF;
    IF NOT has_function_privilege('wam_ai_business_actions', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'actions role missing EXECUTE on % after hardening restore', v_sig;
    END IF;
    IF has_function_privilege('wam_ai_business_readonly', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'readonly has EXECUTE on %', v_sig;
    END IF;
    IF has_function_privilege('public', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC has EXECUTE on %', v_sig;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon has EXECUTE on %', v_sig;
    END IF;
    IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated has EXECUTE on %', v_sig;
    END IF;
  END LOOP;
END $$;

\echo 'phase1a5_packaging_defects_pass'
