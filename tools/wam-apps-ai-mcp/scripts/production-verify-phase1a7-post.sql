-- Phase 1A.7 POST-MIGRATION checks (OID / regprocedure only)
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_read_sigs text[] := ARRAY[
    'wam_ai.reconcile_customer_batch(jsonb)',
    'wam_ai.get_agent_lifecycle(uuid,text)',
    'wam_ai.get_notification_capability_catalogue()'
  ];
  v_denied text[] := ARRAY['public', 'anon', 'authenticated', 'wam_ai_business_actions'];
  v_sig text;
  v_oid oid;
  v_readonly text := 'wam_ai_business_readonly';
  v_denied_role text;
BEGIN
  FOREACH v_sig IN ARRAY v_read_sigs LOOP
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
    RAISE NOTICE 'PASS: intelligence RPC privilege isolation %', v_sig;
  END LOOP;

  RAISE NOTICE 'PASS: Phase 1A.7 post-migration verification complete';
END $$;
