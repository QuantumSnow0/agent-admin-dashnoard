-- Phase 1A.8 POST checks (incl. session security remediation)
\set ON_ERROR_STOP on
DO $$
DECLARE
  v_readonly_ok text[] := ARRAY[
    'wam_ai.begin_reconcile_session(text,text,text,text,integer)',
    'wam_ai.append_reconcile_session_rows(text,jsonb,text,text)',
    'wam_ai.finalize_reconcile_session(text,text,text)',
    'wam_ai.cleanup_own_reconcile_sessions(text,text,integer)',
    'wam_ai.reconcile_customer_batch(jsonb)'
  ];
  v_must_exist text[] := ARRAY[
    'wam_ai.cleanup_expired_reconcile_sessions(integer)',
    'wam_ai._reconcile_customer_batch_internal(jsonb,integer)',
    'wam_ai._reconcile_customer_batch_session(jsonb)'
  ];
  v_readonly_denied text[] := ARRAY[
    'wam_ai.cleanup_expired_reconcile_sessions(integer)',
    'wam_ai._reconcile_customer_batch_internal(jsonb,integer)',
    'wam_ai._reconcile_customer_batch_session(jsonb)'
  ];
  v_denied text[] := ARRAY['public', 'anon', 'authenticated', 'wam_ai_business_actions'];
  v_sig text;
  v_oid oid;
  v_readonly text := 'wam_ai_business_readonly';
  v_denied_role text;
BEGIN
  FOREACH v_sig IN ARRAY v_must_exist LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'FAIL: missing %', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY v_readonly_ok LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'FAIL: missing %', v_sig; END IF;
    IF NOT has_function_privilege(v_readonly, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: readonly missing EXECUTE on %', v_sig;
    END IF;
    FOREACH v_denied_role IN ARRAY v_denied LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_denied_role)
         AND has_function_privilege(v_denied_role, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: % has EXECUTE on %', v_denied_role, v_sig;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_sig IN ARRAY v_readonly_denied LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'FAIL: missing %', v_sig; END IF;
    IF has_function_privilege(v_readonly, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: readonly has EXECUTE on %', v_sig;
    END IF;
    FOREACH v_denied_role IN ARRAY v_denied LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_denied_role)
         AND has_function_privilege(v_denied_role, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: % has EXECUTE on %', v_denied_role, v_sig;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'PASS: Phase 1A.8 post-migration verification complete';
END $$;
