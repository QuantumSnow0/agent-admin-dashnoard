-- WAM APPS AI Phase 1A.4 — POST-MIGRATION production verification (remediated)
\set ON_ERROR_STOP on

\echo '=== Phase 1A.4 POST-MIGRATION checks ==='

DO $post$
DECLARE
  v_action_sigs text[] := ARRAY[
    'wam_ai.send_agent_notification(uuid,text,text,text,text,text,uuid,uuid,text,text,text,text,text)'
  ];
  v_read_sigs text[] := ARRAY[
    'wam_ai.get_agent_notification_history(uuid,text,timestamptz,timestamptz,integer)',
    'wam_ai.get_notification_delivery_status(text,uuid,text)'
  ];
  v_helper_names text[] := ARRAY[
    'notification_ref',
    '_resolve_notification_id_by_ref',
    '_action_idempotency_advisory_lock',
    'notification_action_fingerprint',
    '_agent_has_active_device_token',
    '_notification_historical_delivery_evidence',
    '_validate_wam_notification_content'
  ];
  v_sig text;
  v_oid oid;
  v_cfg text;
  v_role text := 'wam_ai_business_actions';
  v_readonly text := 'wam_ai_business_readonly';
  v_name text;
  r record;
BEGIN
  FOREACH v_sig IN ARRAY v_action_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'FAIL: missing %', v_sig; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef) THEN
      RAISE EXCEPTION 'FAIL: NOT SECURITY DEFINER %', v_sig;
    END IF;
    SELECT array_to_string(proconfig, ',') INTO v_cfg FROM pg_proc WHERE oid = v_oid;
    IF v_cfg IS NULL OR v_cfg NOT ILIKE '%search_path%' THEN
      RAISE EXCEPTION 'FAIL: search_path not pinned on %', v_sig;
    END IF;
    IF NOT has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % missing EXECUTE on %', v_role, v_sig;
    END IF;
    IF has_function_privilege(v_readonly, v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: readonly can EXECUTE %', v_sig;
    END IF;
    RAISE NOTICE 'PASS: action RPC %', v_sig;
  END LOOP;

  FOREACH v_sig IN ARRAY v_read_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'FAIL: missing %', v_sig; END IF;
    IF NOT has_function_privilege(v_readonly, v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: readonly missing EXECUTE on %', v_sig;
    END IF;
    IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: action role can EXECUTE read RPC %', v_sig;
    END IF;
    RAISE NOTICE 'PASS: read RPC %', v_sig;
  END LOOP;

  IF to_regprocedure('wam_ai._notification_delivery_snapshot(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: deprecated _notification_delivery_snapshot still present';
  END IF;

  IF to_regprocedure('wam_ai._action_idempotency_advisory_lock(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing _action_idempotency_advisory_lock';
  END IF;

  FOREACH v_name IN ARRAY v_helper_names LOOP
    FOR r IN
      SELECT p.oid::regprocedure AS sig FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'wam_ai' AND p.proname = v_name
    LOOP
      IF has_function_privilege(v_role, r.sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: action role can EXECUTE helper %', v_name;
      END IF;
      IF has_function_privilege(v_readonly, r.sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: readonly can EXECUTE helper %', v_name;
      END IF;
    END LOOP;
  END LOOP;

  IF has_table_privilege(v_role, 'public.notifications', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL: action role has direct INSERT on notifications';
  END IF;

  RAISE NOTICE 'PASS: Phase 1A.4 post-migration verification complete';
END;
$post$;
