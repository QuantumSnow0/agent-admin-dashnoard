-- WAM APPS AI Phase 1A.3 — POST-MIGRATION production verification
-- Read-only. No customer/agent row dumps. Fail closed.
-- Usage: psql "$AGENT_HUB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/production-verify-phase1a3-post.sql

\echo '=== Phase 1A.3 POST-MIGRATION checks ==='

DO $post$
DECLARE
  v_sigs text[] := ARRAY[
    'wam_ai.approve_agent(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.reject_agent(uuid,text,uuid,uuid,text,text,text,text,text)',
    'wam_ai.ban_agent(uuid,text,uuid,uuid,text,text,text,text,text)',
    'wam_ai.restore_agent(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.change_agent_dispatch_scope(uuid,text,text,uuid,uuid,text,text,text,text)',
    'wam_ai.reject_airtel_registration(uuid,text,uuid,uuid,text,text,text,text,text)',
    'wam_ai.mark_airtel_registration_duplicate(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.cancel_airtel_registration(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.confirm_airtel_registration_installation(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.reject_safaricom_registration(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.mark_safaricom_registration_duplicate(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.cancel_safaricom_registration(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.confirm_safaricom_registration_installation(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.confirm_lead_installation(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.mark_lead_rejected(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.mark_lead_duplicate(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.mark_lead_cancelled(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.mark_lead_lost(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.mark_lead_needs_reassignment(uuid,text,uuid,uuid,text,text,text,text)',
    'wam_ai.revert_lead_pending_install(uuid,text,uuid,uuid,text,text,text,text)'
  ];
  v_sig text;
  v_oid oid;
  v_cfg text;
  v_fail text[] := ARRAY[]::text[];
  v_pass int := 0;
  v_role text := 'wam_ai_business_actions';
  v_readonly text := 'wam_ai_business_readonly';
  v_bad int;
  r record;
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      v_fail := array_append(v_fail, 'MISSING ' || v_sig);
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef) THEN
      v_fail := array_append(v_fail, 'NOT SECURITY DEFINER ' || v_sig);
      CONTINUE;
    END IF;
    SELECT array_to_string(proconfig, ',') INTO v_cfg FROM pg_proc WHERE oid = v_oid;
    IF v_cfg IS NULL OR v_cfg NOT ILIKE '%search_path%' THEN
      v_fail := array_append(v_fail, 'search_path not pinned ' || v_sig);
      CONTINUE;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS: %', v_sig;
  END LOOP;

  IF cardinality(v_fail) > 0 THEN
    RAISE EXCEPTION 'FAIL: Phase 1A.3 RPC catalogue incomplete: %', array_to_string(v_fail, ' | ');
  END IF;
  IF v_pass <> 20 THEN
    RAISE EXCEPTION 'FAIL: expected 20 Phase 1A.3 RPCs, got %', v_pass;
  END IF;
  RAISE NOTICE 'PASS: all 20 Phase 1A.3 exact signatures present with SECURITY DEFINER + search_path';

  -- Grants: action role EXECUTE on approved only; helpers denied
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE EXCEPTION 'FAIL: role % missing', v_role;
  END IF;

  FOREACH v_sig IN ARRAY v_sigs LOOP
    IF NOT has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % missing EXECUTE on %', v_role, v_sig;
    END IF;
    IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: PUBLIC can EXECUTE %', v_sig;
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon can EXECUTE %', v_sig;
    END IF;
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated can EXECUTE %', v_sig;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_readonly)
       AND has_function_privilege(v_readonly, v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: readonly can EXECUTE %', v_sig;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: action EXECUTE grants + PUBLIC/anon/authenticated/readonly denied';

  -- create_lead_offer remains granted to action role
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.create_lead_offer(uuid,text,uuid,text,uuid,uuid,text,text,text,uuid,text,boolean,double precision,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: action role missing create_lead_offer EXECUTE';
  END IF;

  -- Helpers must not be executable by action/readonly/PUBLIC
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='wam_ai' AND p.proname IN (
      '_resolve_agent_for_action','_agent_idempotency_begin','_resolve_registration_id',
      '_resolve_lead_for_action','_mark_lead_terminal_status','_notification_row_created',
      'agent_action_fingerprint','registration_action_fingerprint','lead_status_action_fingerprint',
      'action_requests_deny_mutation'
    )
  LOOP
    IF has_function_privilege(v_role, r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: action role can EXECUTE helper %', r.proname;
    END IF;
    IF has_function_privilege('public', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: PUBLIC can EXECUTE helper %', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: action helpers denied';

  -- Immutability triggers on audit tables
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='wam_ai' AND t.relname='action_requests' AND NOT tg.tgisinternal
      AND pg_get_triggerdef(tg.oid) ILIKE '%action_requests_deny_mutation%'
  ) THEN
    RAISE EXCEPTION 'FAIL: action_requests immutability trigger missing (expected trg_action_requests_no_update)';
  END IF;
  IF to_regprocedure('wam_ai.action_requests_deny_mutation()') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing wam_ai.action_requests_deny_mutation';
  END IF;
  IF has_function_privilege('public', 'wam_ai.action_requests_deny_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: PUBLIC can EXECUTE action_requests_deny_mutation';
  END IF;
  RAISE NOTICE 'PASS: action_requests immutability present';

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='wam_ai' AND t.relname='action_events' AND NOT tg.tgisinternal
      AND pg_get_triggerdef(tg.oid) ILIKE '%action_events_deny_mutation%'
  ) THEN
    RAISE EXCEPTION 'FAIL: action_events immutability trigger missing';
  END IF;
  RAISE NOTICE 'PASS: action_events immutability present';

  -- Re-check notification trigger bindings still required for honest notification matrix
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='agents' AND NOT tg.tgisinternal
      AND pg_get_triggerdef(tg.oid) ILIKE '%create_account_status_notification%'
  ) THEN
    RAISE EXCEPTION 'FAIL: account status notification trigger missing post-migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='customer_registrations' AND NOT tg.tgisinternal
      AND pg_get_triggerdef(tg.oid) ILIKE '%create_registration_status_notification%'
  ) THEN
    RAISE EXCEPTION 'FAIL: registration notification trigger missing post-migration';
  END IF;
  RAISE NOTICE 'PASS: notification trigger bindings still present';

  SELECT count(*)::int INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='wam_ai'
    AND p.proname NOT IN (
      'create_lead_offer','approve_agent','reject_agent','ban_agent','restore_agent',
      'change_agent_dispatch_scope','reject_airtel_registration','mark_airtel_registration_duplicate',
      'cancel_airtel_registration','confirm_airtel_registration_installation',
      'reject_safaricom_registration','mark_safaricom_registration_duplicate',
      'cancel_safaricom_registration','confirm_safaricom_registration_installation',
      'confirm_lead_installation','mark_lead_rejected','mark_lead_duplicate','mark_lead_cancelled',
      'mark_lead_lost','mark_lead_needs_reassignment','revert_lead_pending_install'
    )
    AND has_function_privilege(v_role, p.oid, 'EXECUTE');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAIL: action role can EXECUTE % unapproved wam_ai function(s)', v_bad;
  END IF;
  RAISE NOTICE 'PASS: no unapproved wam_ai EXECUTE for action role';
END;
$post$;

\echo 'production_verify_phase1a3_post_pass'
