-- WAM AI Phase 1A.3 — action role privilege gate (expanded)
-- Run as privileged operator AFTER wam_ai_business_actions role creation and grants.
-- Usage: psql -v ON_ERROR_STOP=1 -f scripts/action-privilege-gate.sql

DO $gate$
DECLARE
  v_role text := 'wam_ai_business_actions';
  v_readonly text := 'wam_ai_business_readonly';
  v_super boolean;
  v_bypass boolean;
  v_login boolean;
  v_public_exec_count integer;
  v_wam_exec_count integer;
  v_unapproved_count integer;
  v_priv boolean;
  v_tbl text;
  v_priv_kind text;
  v_readonly_create integer;
  v_recommend boolean;
  v_auth boolean;
  v_vault boolean;
  r record;
  v_allowed text[] := ARRAY[
    'create_lead_offer',
    'approve_agent',
    'reject_agent',
    'ban_agent',
    'restore_agent',
    'change_agent_dispatch_scope',
    'reject_airtel_registration',
    'mark_airtel_registration_duplicate',
    'cancel_airtel_registration',
    'confirm_airtel_registration_installation',
    'reject_safaricom_registration',
    'mark_safaricom_registration_duplicate',
    'cancel_safaricom_registration',
    'confirm_safaricom_registration_installation',
    'confirm_lead_installation',
    'mark_lead_rejected',
    'mark_lead_duplicate',
    'mark_lead_cancelled',
    'mark_lead_lost',
    'mark_lead_needs_reassignment',
    'revert_lead_pending_install',
    'send_agent_notification',
    'mark_lead_kyc_completed',
    'mark_lead_pending_install',
    'expire_lead_offer',
    'set_agent_pending',
    'set_agent_fallback_dispatch',
    'set_agent_service_radius',
    'reopen_airtel_registration_pending',
    'reopen_safaricom_registration_pending',
    'prepare_send_agent_sms',
    'finalize_send_agent_sms'
  ];
  v_helper_names text[] := ARRAY[
    'offer_ref',
    'action_request_fingerprint',
    'agent_action_fingerprint',
    'registration_action_fingerprint',
    'lead_status_action_fingerprint',
    'registration_ref',
    'resolve_agent_id_from_business_ref',
    'action_events_deny_mutation',
    'action_requests_deny_mutation',
    'assert_wam_action_actor',
    'load_dispatch_snapshot',
    'lead_recommendation_compatible',
    'recommend_agents_for_lead',
    'record_audit_event',
    'get_operational_summary',
    'search_agents',
    '_resolve_agent_for_action',
    '_agent_idempotency_begin',
    '_resolve_registration_id',
    '_resolve_lead_for_action',
    '_mark_lead_terminal_status',
    '_notification_row_created',
    'notification_ref',
    '_resolve_notification_id_by_ref',
    '_action_idempotency_advisory_lock',
    'notification_action_fingerprint',
    '_agent_has_active_device_token',
    '_notification_historical_delivery_evidence',
    '_validate_wam_notification_content',
    '_clamp_service_radius_km',
    '_resolve_offer_for_action',
    'offer_action_fingerprint',
    '_mark_lead_pipeline_status',
    '_lead_financial_state_present',
    '_registration_financial_state_present',
    '_reopen_registration_pending',
    'sms_ref',
    'normalize_kenyan_msisdn',
    'mask_kenyan_msisdn',
    'sms_destination_fingerprint',
    'sms_message_fingerprint',
    'sms_action_fingerprint',
    'sms_encoding_estimate',
    'sms_segment_estimate',
    '_validate_wam_sms_content',
    'normalize_agent_business_ref',
    'reconcile_customer_batch',
    'get_agent_lifecycle',
    'get_notification_capability_catalogue'
  ];
  v_protected_tables text[] := ARRAY[
    'public.inbound_leads',
    'public.lead_offers',
    'public.notifications',
    'public.notification_push_receipts',
    'public.device_tokens',
    'public.agents',
    'public.agent_dispatch_settings',
    'public.customer_registrations',
    'public.safaricom_registrations',
    'public.dispatch_config',
    'wam_ai.action_requests',
    'wam_ai.action_events',
    'wam_ai.audit_events',
    'wam_ai.sms_send_intents'
  ];
  v_privileges text[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: role % does not exist', v_role;
  END IF;

  IF to_regprocedure(
    'wam_ai.create_lead_offer(uuid,text,uuid,text,uuid,uuid,text,text,text,uuid,text,boolean,double precision,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: missing wam_ai.create_lead_offer (apply Phase 1A.2b migration)';
  END IF;

  IF to_regprocedure(
    'wam_ai.approve_agent(uuid,text,uuid,uuid,text,text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: missing wam_ai.approve_agent (apply Phase 1A.3 migration)';
  END IF;

  SELECT rolsuper, rolbypassrls, rolcanlogin
  INTO v_super, v_bypass, v_login
  FROM pg_roles WHERE rolname = v_role;

  IF v_super IS DISTINCT FROM false OR v_bypass IS DISTINCT FROM false OR v_login IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'action_privilege_gate_fail: role flags rolsuper=%, rolbypassrls=%, rolcanlogin=% (expect false,false,true)',
      v_super, v_bypass, v_login;
  END IF;

  FOREACH v_tbl IN ARRAY v_protected_tables LOOP
    IF to_regclass(v_tbl) IS NULL THEN
      RAISE EXCEPTION 'action_privilege_gate_fail: missing table %', v_tbl;
    END IF;
    FOREACH v_priv_kind IN ARRAY v_privileges LOOP
      v_priv := has_table_privilege(v_role, v_tbl, v_priv_kind);
      IF v_priv THEN
        RAISE EXCEPTION 'action_privilege_gate_fail: role has % on %', v_priv_kind, v_tbl;
      END IF;
    END LOOP;
  END LOOP;

  SELECT count(*)::int INTO v_public_exec_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege(v_role, p.oid, 'EXECUTE');
  IF v_public_exec_count > 0 THEN
    RAISE EXCEPTION
      'action_privilege_gate_fail: action role has EXECUTE on % public.* function(s)',
      v_public_exec_count;
  END IF;

  SELECT count(*)::int INTO v_unapproved_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'wam_ai'
    AND p.proname = ANY (v_allowed)
    AND NOT has_function_privilege(v_role, p.oid, 'EXECUTE');
  IF v_unapproved_count > 0 THEN
    RAISE EXCEPTION
      'action_privilege_gate_fail: action role missing EXECUTE on % approved action RPC(s)',
      v_unapproved_count;
  END IF;

  SELECT count(*)::int INTO v_wam_exec_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'wam_ai'
    AND p.proname <> ALL (v_allowed)
    AND has_function_privilege(v_role, p.oid, 'EXECUTE');
  IF v_wam_exec_count > 0 THEN
    RAISE EXCEPTION
      'action_privilege_gate_fail: action role can EXECUTE % unapproved wam_ai function(s) (includes PUBLIC inheritance — revoke PUBLIC/anon/authenticated EXECUTE on wam_ai helpers and read RPCs)',
      v_wam_exec_count;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_readonly) THEN
    SELECT count(*)::int INTO v_readonly_create
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname = ANY (v_allowed)
      AND has_function_privilege(v_readonly, p.oid, 'EXECUTE');
    IF v_readonly_create > 0 THEN
      RAISE EXCEPTION 'action_privilege_gate_fail: readonly role can EXECUTE % action RPC(s)', v_readonly_create;
    END IF;
    v_recommend := has_function_privilege(
      v_readonly,
      'wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer)',
      'EXECUTE');
    IF NOT v_recommend THEN
      RAISE EXCEPTION 'action_privilege_gate_fail: readonly role lost recommend_agents_for_lead';
    END IF;
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname = ANY (v_helper_names)
  LOOP
    IF has_function_privilege(v_role, r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'action_privilege_gate_fail: action role can EXECUTE helper %', r.proname;
    END IF;
    IF has_function_privilege('public', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'action_privilege_gate_fail: PUBLIC can EXECUTE helper %', r.proname;
    END IF;
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'action_privilege_gate_fail: anon can EXECUTE helper %', r.proname;
    END IF;
    IF has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'action_privilege_gate_fail: authenticated can EXECUTE helper %', r.proname;
    END IF;
  END LOOP;

  IF to_regprocedure('wam_ai.action_events_deny_mutation()') IS NULL THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: missing wam_ai.action_events_deny_mutation';
  END IF;
  IF has_function_privilege('public', 'wam_ai.action_events_deny_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: PUBLIC can EXECUTE action_events_deny_mutation';
  END IF;
  IF has_function_privilege(v_role, 'wam_ai.action_events_deny_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: action role can EXECUTE action_events_deny_mutation';
  END IF;

  IF to_regprocedure('wam_ai.action_requests_deny_mutation()') IS NULL THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: missing wam_ai.action_requests_deny_mutation';
  END IF;
  IF has_function_privilege('public', 'wam_ai.action_requests_deny_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: PUBLIC can EXECUTE action_requests_deny_mutation';
  END IF;
  IF has_function_privilege(v_role, 'wam_ai.action_requests_deny_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: action role can EXECUTE action_requests_deny_mutation';
  END IF;

  v_auth := has_schema_privilege(v_role, 'auth', 'USAGE');
  v_vault := has_schema_privilege(v_role, 'vault', 'USAGE');
  IF v_auth OR v_vault THEN
    RAISE EXCEPTION 'action_privilege_gate_fail: action role has USAGE on auth/vault';
  END IF;

  RAISE NOTICE 'action_privilege_gate_pass: wam_ai_business_actions least-privilege checks OK (Phase 1A.5)';
END;
$gate$;
