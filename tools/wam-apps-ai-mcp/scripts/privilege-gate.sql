-- WAM AI Phase 1A + 1A.1 — privilege gate
-- Run as privileged operator AFTER role creation and grants.
-- Usage: psql -v ON_ERROR_STOP=1 -f scripts/privilege-gate.sql

DO $gate$
DECLARE
  v_role text := 'wam_ai_business_readonly';
  v_super boolean;
  v_bypass boolean;
  v_login boolean;
  v_can_reverse boolean;
  v_public_exec_count integer;
  v_sel_inbound boolean;
  v_sel_agents boolean;
  v_sel_payments boolean;
  v_sel_tokens boolean;
  v_sel_audit boolean;
  v_ins boolean;
  v_upd boolean;
  v_del boolean;
  v_ops boolean;
  v_audit boolean;
  v_auth boolean;
  v_vault boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE EXCEPTION 'privilege_gate_fail: role % does not exist', v_role;
  END IF;

  IF to_regclass('public.inbound_leads') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing table public.inbound_leads';
  END IF;
  IF to_regclass('public.agents') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing table public.agents';
  END IF;
  IF to_regclass('public.agent_payments') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing table public.agent_payments';
  END IF;
  IF to_regclass('public.device_tokens') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing table public.device_tokens';
  END IF;
  IF to_regclass('wam_ai.audit_events') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing table wam_ai.audit_events (apply reporting migration)';
  END IF;
  IF to_regprocedure('public.admin_reverse_agent_payment(uuid)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing function public.admin_reverse_agent_payment(uuid)';
  END IF;
  IF to_regprocedure('wam_ai.get_operational_summary(timestamptz,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_operational_summary';
  END IF;
  IF to_regprocedure('wam_ai.search_agents(text,text,text,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.search_agents (apply Phase 1A.1 migration)';
  END IF;
  IF to_regprocedure('wam_ai.get_agent_details(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_agent_details (apply Phase 1A.1 migration)';
  END IF;
  IF to_regprocedure('wam_ai.search_customers(text,text,text,text,text,text,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.search_customers (apply Phase 1A.1 migration)';
  END IF;
  IF to_regprocedure('wam_ai.get_customer_details(text,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_customer_details (apply Phase 1A.1 migration)';
  END IF;
  IF to_regprocedure('wam_ai.search_leads(text,text,text,text,text,text,text,uuid,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.search_leads (apply Phase 1A.1 migration)';
  END IF;
  IF to_regprocedure('wam_ai.get_lead_details(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_lead_details (apply Phase 1A.1 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.get_agent_registration_performance(timestamptz,timestamptz,text,uuid,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_agent_registration_performance';
  END IF;
  IF to_regprocedure(
    'wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.recommend_agents_for_lead (apply Phase 1A.2a migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.get_agent_notification_history(uuid,text,timestamptz,timestamptz,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_agent_notification_history (apply Phase 1A.4 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.get_notification_delivery_status(text,uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_notification_delivery_status (apply Phase 1A.4 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.preview_agent_sms_recipient(uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.preview_agent_sms_recipient (apply Phase 1A.6 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.get_agent_sms_history(uuid,text,timestamptz,timestamptz,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_agent_sms_history (apply Phase 1A.6 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.get_sms_delivery_status(text,uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_sms_delivery_status (apply Phase 1A.6 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.reconcile_customer_batch(jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.reconcile_customer_batch (apply Phase 1A.7 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.get_agent_lifecycle(uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_agent_lifecycle (apply Phase 1A.7 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.get_notification_capability_catalogue()'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.get_notification_capability_catalogue (apply Phase 1A.7 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.begin_reconcile_session(text,text,text,text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.begin_reconcile_session (apply Phase 1A.8 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.append_reconcile_session_rows(text,jsonb,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.append_reconcile_session_rows (apply Phase 1A.8 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.finalize_reconcile_session(text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.finalize_reconcile_session (apply Phase 1A.8 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.cleanup_expired_reconcile_sessions(integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.cleanup_expired_reconcile_sessions (apply Phase 1A.8 migration)';
  END IF;
  IF to_regprocedure(
    'wam_ai.cleanup_own_reconcile_sessions(text,text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.cleanup_own_reconcile_sessions (apply Phase 1A.8 remediation)';
  END IF;
  IF to_regprocedure(
    'wam_ai._reconcile_customer_batch_internal(jsonb,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai._reconcile_customer_batch_internal (apply Phase 1A.8 remediation)';
  END IF;
  IF to_regprocedure(
    'wam_ai._reconcile_customer_batch_session(jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai._reconcile_customer_batch_session (apply Phase 1A.8 remediation)';
  END IF;
  IF to_regprocedure(
    'wam_ai.record_audit_event(uuid,text,text,text,text,text,text,jsonb,text,integer,text,text,integer,text,boolean)'
  ) IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing 15-arg wam_ai.record_audit_event overload';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing schema auth (add via disposable-stubs or environment)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing schema vault (add via disposable-stubs or environment)';
  END IF;

  SELECT rolsuper, rolbypassrls, rolcanlogin
  INTO v_super, v_bypass, v_login
  FROM pg_roles WHERE rolname = v_role;

  IF v_super IS DISTINCT FROM false OR v_bypass IS DISTINCT FROM false OR v_login IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'privilege_gate_fail: role flags rolsuper=%, rolbypassrls=%, rolcanlogin=% (expect false,false,true)',
      v_super, v_bypass, v_login;
  END IF;

  v_can_reverse := has_function_privilege(
    v_role, 'public.admin_reverse_agent_payment(uuid)', 'EXECUTE');
  IF v_can_reverse THEN
    RAISE EXCEPTION 'privilege_gate_fail: role can EXECUTE admin_reverse_agent_payment';
  END IF;

  SELECT count(*)::int INTO v_public_exec_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege(v_role, p.oid, 'EXECUTE');
  IF v_public_exec_count > 0 THEN
    RAISE EXCEPTION
      'privilege_gate_fail: role still has EXECUTE on % public.* function(s)',
      v_public_exec_count;
  END IF;

  v_sel_inbound := has_table_privilege(v_role, 'public.inbound_leads', 'SELECT');
  v_sel_agents := has_table_privilege(v_role, 'public.agents', 'SELECT');
  v_sel_payments := has_table_privilege(v_role, 'public.agent_payments', 'SELECT');
  v_sel_tokens := has_table_privilege(v_role, 'public.device_tokens', 'SELECT');
  v_sel_audit := has_table_privilege(v_role, 'wam_ai.audit_events', 'SELECT');
  IF v_sel_inbound OR v_sel_agents OR v_sel_payments OR v_sel_tokens OR v_sel_audit THEN
    RAISE EXCEPTION 'privilege_gate_fail: role has unexpected SELECT on base tables';
  END IF;

  v_ins := has_table_privilege(v_role, 'public.inbound_leads', 'INSERT');
  v_upd := has_table_privilege(v_role, 'public.inbound_leads', 'UPDATE');
  v_del := has_table_privilege(v_role, 'public.inbound_leads', 'DELETE');
  IF v_ins OR v_upd OR v_del THEN
    RAISE EXCEPTION 'privilege_gate_fail: role can mutate public.inbound_leads';
  END IF;

  v_ops := has_function_privilege(
    v_role, 'wam_ai.get_operational_summary(timestamptz,timestamptz,text)', 'EXECUTE');
  IF NOT v_ops THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_operational_summary';
  END IF;

  IF NOT has_function_privilege(
    v_role, 'wam_ai.search_agents(text,text,text,text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on search_agents';
  END IF;
  IF NOT has_function_privilege(
    v_role, 'wam_ai.get_agent_details(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_agent_details';
  END IF;
  IF NOT has_function_privilege(
    v_role, 'wam_ai.search_customers(text,text,text,text,text,text,uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on search_customers';
  END IF;
  IF NOT has_function_privilege(
    v_role, 'wam_ai.get_customer_details(text,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_customer_details';
  END IF;
  IF NOT has_function_privilege(
    v_role, 'wam_ai.search_leads(text,text,text,text,text,text,text,uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on search_leads';
  END IF;
  IF NOT has_function_privilege(
    v_role, 'wam_ai.get_lead_details(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_lead_details';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.get_agent_registration_performance(timestamptz,timestamptz,text,uuid,integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_agent_registration_performance';
  END IF;

  IF NOT has_function_privilege(
    v_role,
    'wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on recommend_agents_for_lead';
  END IF;

  IF NOT has_function_privilege(
    v_role,
    'wam_ai.get_agent_notification_history(uuid,text,timestamptz,timestamptz,integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_agent_notification_history';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.get_notification_delivery_status(text,uuid,text)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_notification_delivery_status';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.preview_agent_sms_recipient(uuid,text,text)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on preview_agent_sms_recipient';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.get_agent_sms_history(uuid,text,timestamptz,timestamptz,integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_agent_sms_history';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.get_sms_delivery_status(text,uuid,text)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_sms_delivery_status';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.reconcile_customer_batch(jsonb)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on reconcile_customer_batch';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.get_agent_lifecycle(uuid,text)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_agent_lifecycle';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.get_notification_capability_catalogue()',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on get_notification_capability_catalogue';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.begin_reconcile_session(text,text,text,text,integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on begin_reconcile_session';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.append_reconcile_session_rows(text,jsonb,text,text)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on append_reconcile_session_rows';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.finalize_reconcile_session(text,text,text)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on finalize_reconcile_session';
  END IF;
  IF NOT has_function_privilege(
    v_role,
    'wam_ai.cleanup_own_reconcile_sessions(text,text,integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on cleanup_own_reconcile_sessions';
  END IF;

  -- Phase 1A.9 semantic query RPCs
  IF to_regprocedure('wam_ai.describe_business_query_catalogue(text)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.describe_business_query_catalogue (apply Phase 1A.9 migration)';
  END IF;
  IF to_regprocedure('wam_ai.list_business_records(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.list_business_records (apply Phase 1A.9 migration)';
  END IF;
  IF to_regprocedure('wam_ai.aggregate_business_metrics(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing wam_ai.aggregate_business_metrics (apply Phase 1A.9 migration)';
  END IF;
  IF NOT has_function_privilege(
    v_role, 'wam_ai.describe_business_query_catalogue(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on describe_business_query_catalogue';
  END IF;
  IF NOT has_function_privilege(
    v_role, 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on list_business_records';
  END IF;
  IF NOT has_function_privilege(
    v_role, 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on aggregate_business_metrics';
  END IF;
  IF has_function_privilege('public', 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: PUBLIC can EXECUTE list_business_records';
  END IF;
  IF has_function_privilege('anon', 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: anon can EXECUTE list_business_records';
  END IF;
  IF has_function_privilege('authenticated', 'wam_ai.list_business_records(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: authenticated can EXECUTE list_business_records';
  END IF;
  IF has_function_privilege('public', 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: PUBLIC can EXECUTE aggregate_business_metrics';
  END IF;
  IF has_function_privilege('anon', 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: anon can EXECUTE aggregate_business_metrics';
  END IF;
  IF has_function_privilege('authenticated', 'wam_ai.aggregate_business_metrics(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: authenticated can EXECUTE aggregate_business_metrics';
  END IF;
  IF has_table_privilege(v_role, 'public.customer_registrations', 'SELECT')
     OR has_table_privilege(v_role, 'public.safaricom_registrations', 'SELECT') THEN
    RAISE EXCEPTION 'privilege_gate_fail: role has unexpected SELECT on registration base tables';
  END IF;

  IF has_function_privilege(
    v_role,
    'wam_ai.cleanup_expired_reconcile_sessions(integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: readonly must not EXECUTE cleanup_expired_reconcile_sessions';
  END IF;
  IF has_function_privilege(
    v_role,
    'wam_ai._reconcile_customer_batch_internal(jsonb,integer)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: readonly must not EXECUTE _reconcile_customer_batch_internal';
  END IF;
  IF has_function_privilege(
    v_role,
    'wam_ai._reconcile_customer_batch_session(jsonb)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: readonly must not EXECUTE _reconcile_customer_batch_session';
  END IF;

  -- Phase 1A.8 session RPCs / private helpers must not be granted to the action role
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    IF has_function_privilege(
      'wam_ai_business_actions',
      'wam_ai.begin_reconcile_session(text,text,text,text,integer)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: action role can EXECUTE begin_reconcile_session';
    END IF;
    IF has_function_privilege(
      'wam_ai_business_actions',
      'wam_ai.finalize_reconcile_session(text,text,text)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: action role can EXECUTE finalize_reconcile_session';
    END IF;
    IF has_function_privilege(
      'wam_ai_business_actions',
      'wam_ai.cleanup_expired_reconcile_sessions(integer)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: action role can EXECUTE cleanup_expired_reconcile_sessions';
    END IF;
    IF has_function_privilege(
      'wam_ai_business_actions',
      'wam_ai.cleanup_own_reconcile_sessions(text,text,integer)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: action role can EXECUTE cleanup_own_reconcile_sessions';
    END IF;
    IF has_function_privilege(
      'wam_ai_business_actions',
      'wam_ai._reconcile_customer_batch_internal(jsonb,integer)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: action role can EXECUTE _reconcile_customer_batch_internal';
    END IF;
    IF has_function_privilege(
      'wam_ai_business_actions',
      'wam_ai._reconcile_customer_batch_session(jsonb)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: action role can EXECUTE _reconcile_customer_batch_session';
    END IF;
    IF has_function_privilege(
      'wam_ai_business_actions',
      'wam_ai.list_business_records(jsonb)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: action role can EXECUTE list_business_records';
    END IF;
    IF has_function_privilege(
      'wam_ai_business_actions',
      'wam_ai.aggregate_business_metrics(jsonb)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: action role can EXECUTE aggregate_business_metrics';
    END IF;
    IF has_function_privilege(
      'wam_ai_business_actions',
      'wam_ai.describe_business_query_catalogue(text)',
      'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: action role can EXECUTE describe_business_query_catalogue';
    END IF;
  END IF;

  v_audit := has_function_privilege(
    v_role,
    'wam_ai.record_audit_event(uuid,text,text,text,text,text,text,jsonb,text,integer,text,text,integer,text,boolean)',
    'EXECUTE');
  IF NOT v_audit THEN
    RAISE EXCEPTION 'privilege_gate_fail: missing EXECUTE on 15-arg record_audit_event';
  END IF;

  v_auth := has_schema_privilege(v_role, 'auth', 'USAGE');
  v_vault := has_schema_privilege(v_role, 'vault', 'USAGE');
  IF v_auth OR v_vault THEN
    RAISE EXCEPTION 'privilege_gate_fail: role has USAGE on auth/vault';
  END IF;

  -- Phase 1A.2: protected helpers must not be independently executable
  IF has_function_privilege('public', 'wam_ai.load_dispatch_snapshot()', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: PUBLIC can EXECUTE wam_ai.load_dispatch_snapshot';
  END IF;
  IF has_function_privilege('anon', 'wam_ai.load_dispatch_snapshot()', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: anon can EXECUTE wam_ai.load_dispatch_snapshot';
  END IF;
  IF has_function_privilege('authenticated', 'wam_ai.load_dispatch_snapshot()', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: authenticated can EXECUTE wam_ai.load_dispatch_snapshot';
  END IF;
  IF has_function_privilege(
    v_role, 'wam_ai.load_dispatch_snapshot()', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: role can independently EXECUTE load_dispatch_snapshot';
  END IF;
  IF has_function_privilege(
    v_role, 'wam_ai.lead_recommendation_compatible(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: role can independently EXECUTE lead_recommendation_compatible';
  END IF;
  IF has_function_privilege(
    'public', 'wam_ai.lead_recommendation_compatible(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: PUBLIC can EXECUTE lead_recommendation_compatible';
  END IF;
  IF has_function_privilege(
    'public', 'wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: PUBLIC can EXECUTE recommend_agents_for_lead';
  END IF;
  IF has_function_privilege(
    'anon', 'wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: anon can EXECUTE recommend_agents_for_lead';
  END IF;
  IF has_function_privilege(
    'authenticated', 'wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: authenticated can EXECUTE recommend_agents_for_lead';
  END IF;
  IF has_function_privilege(
    'public', 'wam_ai.haversine_km(double precision,double precision,double precision,double precision)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: PUBLIC can EXECUTE haversine_km';
  END IF;
  IF has_function_privilege(
    v_role, 'wam_ai.geographic_practicality_label(boolean,boolean,double precision,double precision,integer,double precision,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'privilege_gate_fail: role can independently EXECUTE geographic_practicality_label';
  END IF;

  IF to_regprocedure('wam_ai.action_events_deny_mutation()') IS NOT NULL THEN
    IF has_function_privilege(v_role, 'wam_ai.action_events_deny_mutation()', 'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: readonly role can EXECUTE action_events_deny_mutation';
    END IF;
    IF has_function_privilege('public', 'wam_ai.action_events_deny_mutation()', 'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: PUBLIC can EXECUTE action_events_deny_mutation';
    END IF;
    IF has_function_privilege('anon', 'wam_ai.action_events_deny_mutation()', 'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: anon can EXECUTE action_events_deny_mutation';
    END IF;
    IF has_function_privilege('authenticated', 'wam_ai.action_events_deny_mutation()', 'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: authenticated can EXECUTE action_events_deny_mutation';
    END IF;
  END IF;

  IF to_regprocedure('wam_ai.action_requests_deny_mutation()') IS NOT NULL THEN
    IF has_function_privilege(v_role, 'wam_ai.action_requests_deny_mutation()', 'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: readonly role can EXECUTE action_requests_deny_mutation';
    END IF;
    IF has_function_privilege('public', 'wam_ai.action_requests_deny_mutation()', 'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: PUBLIC can EXECUTE action_requests_deny_mutation';
    END IF;
    IF has_function_privilege('anon', 'wam_ai.action_requests_deny_mutation()', 'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: anon can EXECUTE action_requests_deny_mutation';
    END IF;
    IF has_function_privilege('authenticated', 'wam_ai.action_requests_deny_mutation()', 'EXECUTE') THEN
      RAISE EXCEPTION 'privilege_gate_fail: authenticated can EXECUTE action_requests_deny_mutation';
    END IF;
  END IF;

  -- Phase 1A.3: readonly must never execute business-action RPCs or unclassified helpers.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN (
        'create_lead_offer','approve_agent','reject_agent','ban_agent','restore_agent',
        'change_agent_dispatch_scope','reject_airtel_registration','mark_airtel_registration_duplicate',
        'cancel_airtel_registration','confirm_airtel_registration_installation',
        'reject_safaricom_registration','mark_safaricom_registration_duplicate',
        'cancel_safaricom_registration','confirm_safaricom_registration_installation',
        'confirm_lead_installation','mark_lead_rejected','mark_lead_duplicate','mark_lead_cancelled',
        'mark_lead_lost','mark_lead_needs_reassignment','revert_lead_pending_install',
        'send_agent_notification',
        '_resolve_agent_for_action','_agent_idempotency_begin','_resolve_registration_id',
        '_resolve_lead_for_action','_mark_lead_terminal_status','_notification_row_created',
        'notification_ref','notification_action_fingerprint','_agent_has_active_device_token',
        '_resolve_notification_id_by_ref','_action_idempotency_advisory_lock',
        '_notification_historical_delivery_evidence','_validate_wam_notification_content',
        '_clamp_service_radius_km','_resolve_offer_for_action','offer_action_fingerprint',
        '_mark_lead_pipeline_status','_reopen_registration_pending',
        '_lead_financial_state_present','_registration_financial_state_present'
      )
      AND has_function_privilege(v_role, p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'privilege_gate_fail: readonly role can EXECUTE a business-action RPC or action helper';
  END IF;

  RAISE NOTICE 'privilege_gate_pass: wam_ai_business_readonly least-privilege checks OK';
END;
$gate$;
