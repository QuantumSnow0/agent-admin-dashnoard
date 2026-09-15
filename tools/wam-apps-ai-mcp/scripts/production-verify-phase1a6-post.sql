-- Phase 1A.6 POST-MIGRATION checks (OID / regprocedure only)
-- Includes finalize reservation-binding source contract checks.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_action_sigs text[] := ARRAY[
    'wam_ai.prepare_send_agent_sms(uuid,text,text,text,uuid,uuid,text,text,text,text,text,text)',
    'wam_ai.finalize_send_agent_sms(uuid,uuid,text,text,text,text,text,text,boolean,text)'
  ];
  v_read_sigs text[] := ARRAY[
    'wam_ai.preview_agent_sms_recipient(uuid,text,text)',
    'wam_ai.get_agent_sms_history(uuid,text,timestamptz,timestamptz,integer)',
    'wam_ai.get_sms_delivery_status(text,uuid,text)'
  ];
  v_denied text[] := ARRAY['public', 'anon', 'authenticated', 'wam_ai_business_readonly'];
  v_sig text;
  v_oid oid;
  v_role text := 'wam_ai_business_actions';
  v_readonly text := 'wam_ai_business_readonly';
  v_denied_role text;
  v_src text;
BEGIN
  IF to_regclass('wam_ai.sms_send_intents') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing wam_ai.sms_send_intents';
  END IF;

  FOREACH v_sig IN ARRAY v_action_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'FAIL: missing %', v_sig; END IF;
    IF NOT has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: actions missing EXECUTE on %', v_sig;
    END IF;
    FOREACH v_denied_role IN ARRAY v_denied LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_denied_role)
         AND has_function_privilege(v_denied_role, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: % has EXECUTE on %', v_denied_role, v_sig;
      END IF;
    END LOOP;
    RAISE NOTICE 'PASS: action RPC privilege isolation %', v_sig;
  END LOOP;

  FOREACH v_sig IN ARRAY v_read_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'FAIL: missing %', v_sig; END IF;
    IF NOT has_function_privilege(v_readonly, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: readonly missing EXECUTE on %', v_sig;
    END IF;
    IF has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: actions can EXECUTE read RPC %', v_sig;
    END IF;
    RAISE NOTICE 'PASS: read RPC %', v_sig;
  END LOOP;

  -- Source-level reservation binding contract (proves remediation is applied).
  SELECT pg_get_functiondef(
    to_regprocedure(
      'wam_ai.finalize_send_agent_sms(uuid,uuid,text,text,text,text,text,text,boolean,text)'
    )
  ) INTO v_src;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot load finalize_send_agent_sms definition';
  END IF;
  IF position('correlation_id does not match reservation' IN v_src) = 0 THEN
    RAISE EXCEPTION 'FAIL: finalize missing correlation_id reservation binding';
  END IF;
  IF position('actor_id does not match reservation' IN v_src) = 0 THEN
    RAISE EXCEPTION 'FAIL: finalize missing actor_id reservation binding';
  END IF;
  IF position('actor_role does not match reservation' IN v_src) = 0 THEN
    RAISE EXCEPTION 'FAIL: finalize missing actor_role reservation binding';
  END IF;
  IF position('SMS finalize is restricted to technical_owner' IN v_src) = 0 THEN
    RAISE EXCEPTION 'FAIL: finalize missing technical_owner gate';
  END IF;
  IF position('v_intent.correlation_id, p_idempotency_key, v_intent.actor_id, v_intent.actor_role' IN v_src) = 0 THEN
    RAISE EXCEPTION 'FAIL: finalize action_events must insert reservation identity';
  END IF;
  IF v_src ~ 'INSERT INTO wam_ai\.action_events[\s\S]*VALUES \(\s*p_correlation_id' THEN
    RAISE EXCEPTION 'FAIL: finalize must not insert action_events with caller p_correlation_id';
  END IF;
  IF v_src ~ 'INSERT INTO wam_ai\.action_requests[\s\S]*p_correlation_id, p_actor_id' THEN
    RAISE EXCEPTION 'FAIL: finalize must not insert action_requests with caller identity';
  END IF;
  RAISE NOTICE 'PASS: finalize reservation binding source contract';

  RAISE NOTICE 'PASS: Phase 1A.6 post-migration verification complete';
END $$;
