-- Phase 1A.5 POST-MIGRATION checks
-- has_function_privilege() requires OID or full regprocedure — never bare names.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_action_sigs text[] := ARRAY[
    'wam_ai.mark_lead_kyc_completed(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.mark_lead_pending_install(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.expire_lead_offer(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.set_agent_pending(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.set_agent_fallback_dispatch(uuid,text,boolean,integer,uuid,uuid,text,text,text)',
    'wam_ai.set_agent_service_radius(uuid,text,double precision,boolean,uuid,uuid,text,text,text)',
    'wam_ai.reopen_airtel_registration_pending(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.reopen_safaricom_registration_pending(uuid,text,uuid,uuid,text,text,text,text)'
  ];
  v_helper_sigs text[] := ARRAY[
    'wam_ai._mark_lead_pipeline_status(text,text,uuid,text,uuid,uuid,text,text,text,text[])',
    'wam_ai._lead_financial_state_present(uuid)',
    'wam_ai._resolve_offer_for_action(uuid,text)'
  ];
  v_sig text;
  v_oid oid;
  v_role text := 'wam_ai_business_actions';
  v_readonly text := 'wam_ai_business_readonly';
BEGIN
  FOREACH v_sig IN ARRAY v_action_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'FAIL: missing %', v_sig;
    END IF;
    IF NOT has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: action role missing EXECUTE on %', v_sig;
    END IF;
    IF has_function_privilege(v_readonly, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: readonly role has EXECUTE on %', v_sig;
    END IF;
    IF has_function_privilege('public', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: PUBLIC has EXECUTE on %', v_sig;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon has EXECUTE on %', v_sig;
    END IF;
    IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated has EXECUTE on %', v_sig;
    END IF;
    RAISE NOTICE 'PASS: action RPC %', v_sig;
  END LOOP;

  FOREACH v_sig IN ARRAY v_helper_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'FAIL: missing helper %', v_sig;
    END IF;
    IF has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: action role can EXECUTE helper %', v_sig;
    END IF;
    IF has_function_privilege(v_readonly, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: readonly can EXECUTE helper %', v_sig;
    END IF;
    RAISE NOTICE 'PASS: helper present and ungranted %', v_sig;
  END LOOP;

  RAISE NOTICE 'PASS: Phase 1A.5 post-migration verification complete';
END $$;
