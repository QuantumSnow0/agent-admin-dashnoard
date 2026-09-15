-- WAM APPS AI Phase 1A.3 — PRE-MIGRATION production verification
-- Read-only. No customer/agent row dumps. Fail closed.
-- Usage: psql "$AGENT_HUB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/production-verify-phase1a3-pre.sql

\echo '=== Phase 1A.3 PRE-MIGRATION BASELINE ==='

DO $pre$
DECLARE
  v_missing text;
  v_n int;
  v_con text;
  r record;
BEGIN
  -- Prerequisite tables/columns
  IF to_regclass('public.agents') IS NULL THEN RAISE EXCEPTION 'FAIL: missing public.agents'; END IF;
  IF to_regclass('public.inbound_leads') IS NULL THEN RAISE EXCEPTION 'FAIL: missing public.inbound_leads'; END IF;
  IF to_regclass('public.lead_offers') IS NULL THEN RAISE EXCEPTION 'FAIL: missing public.lead_offers'; END IF;
  IF to_regclass('public.notifications') IS NULL THEN RAISE EXCEPTION 'FAIL: missing public.notifications'; END IF;
  IF to_regclass('public.customer_registrations') IS NULL THEN RAISE EXCEPTION 'FAIL: missing public.customer_registrations'; END IF;
  IF to_regclass('public.safaricom_registrations') IS NULL THEN RAISE EXCEPTION 'FAIL: missing public.safaricom_registrations'; END IF;
  IF to_regclass('public.agent_dispatch_settings') IS NULL THEN RAISE EXCEPTION 'FAIL: missing public.agent_dispatch_settings'; END IF;
  IF to_regclass('wam_ai.audit_events') IS NULL THEN RAISE EXCEPTION 'FAIL: missing wam_ai.audit_events (Phase 1A)'; END IF;
  IF to_regclass('wam_ai.action_requests') IS NULL THEN RAISE EXCEPTION 'FAIL: missing wam_ai.action_requests (Phase 1A.2b)'; END IF;
  IF to_regclass('wam_ai.action_events') IS NULL THEN RAISE EXCEPTION 'FAIL: missing wam_ai.action_events (Phase 1A.2b)'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agents' AND column_name='status'
  ) THEN RAISE EXCEPTION 'FAIL: agents.status missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agents' AND column_name='lead_dispatch_scope'
  ) THEN RAISE EXCEPTION 'FAIL: agents.lead_dispatch_scope missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inbound_leads' AND column_name='commission_earned_ksh'
  ) THEN RAISE EXCEPTION 'FAIL: inbound_leads.commission_earned_ksh missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inbound_leads' AND column_name='assigned_agent_id'
  ) THEN RAISE EXCEPTION 'FAIL: inbound_leads.assigned_agent_id missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='lead_offers' AND column_name='status'
  ) THEN RAISE EXCEPTION 'FAIL: lead_offers.status missing'; END IF;

  -- Status vocabulary (catalog constraints; no row samples)
  SELECT pg_get_constraintdef(c.oid) INTO v_con
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='agents' AND c.contype='c'
    AND pg_get_constraintdef(c.oid) ILIKE '%pending%'
    AND pg_get_constraintdef(c.oid) ILIKE '%approved%'
    AND pg_get_constraintdef(c.oid) ILIKE '%banned%'
  LIMIT 1;
  IF v_con IS NULL THEN
    RAISE EXCEPTION 'FAIL: agents.status check constraint with pending/approved/banned not found';
  END IF;
  RAISE NOTICE 'PASS: agents.status constraint present';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='notifications' AND c.contype='c'
      AND pg_get_constraintdef(c.oid) ILIKE '%ACCOUNT_STATUS_CHANGE%'
      AND pg_get_constraintdef(c.oid) ILIKE '%LEAD_INSTALLED%'
  ) THEN
    RAISE EXCEPTION 'FAIL: notifications.type constraint missing ACCOUNT_STATUS_CHANGE/LEAD_INSTALLED';
  END IF;
  RAISE NOTICE 'PASS: notifications.type constraint includes required values';

  -- Trigger bindings required before GO
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='agents' AND NOT tg.tgisinternal
      AND pg_get_triggerdef(tg.oid) ILIKE '%create_account_status_notification%'
  ) THEN
    RAISE EXCEPTION 'FAIL: account-status notification trigger not bound on public.agents';
  END IF;
  RAISE NOTICE 'PASS: account status notification trigger bound';

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='agents' AND NOT tg.tgisinternal
      AND pg_get_triggerdef(tg.oid) ILIKE '%agents_clear_dispatch_availability%'
  ) THEN
    RAISE EXCEPTION 'FAIL: agents_clear_dispatch_availability trigger not bound';
  END IF;
  RAISE NOTICE 'PASS: dispatch availability clear trigger bound';

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='customer_registrations' AND NOT tg.tgisinternal
      AND (
        pg_get_triggerdef(tg.oid) ILIKE '%update_agent_balance%'
        OR pg_get_triggerdef(tg.oid) ILIKE '%recalculate_agent_airtel_earnings%'
      )
  ) THEN
    RAISE EXCEPTION 'FAIL: Airtel earnings trigger not bound on customer_registrations';
  END IF;
  RAISE NOTICE 'PASS: Airtel earnings trigger bound';

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg JOIN pg_class t ON t.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='customer_registrations' AND NOT tg.tgisinternal
      AND pg_get_triggerdef(tg.oid) ILIKE '%create_registration_status_notification%'
  ) THEN
    RAISE EXCEPTION 'FAIL: registration status notification trigger not bound on customer_registrations';
  END IF;
  RAISE NOTICE 'PASS: registration status notification trigger bound';

  IF to_regprocedure('public.update_agent_balance()') IS NULL
     AND to_regprocedure('public.recalculate_agent_airtel_earnings()') IS NULL THEN
    RAISE EXCEPTION 'FAIL: Airtel earnings function missing';
  END IF;

  -- Active-offer vocabulary
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='lead_offers' AND c.contype='c'
      AND pg_get_constraintdef(c.oid) ILIKE '%offered%'
  ) THEN
    RAISE NOTICE 'WARN: lead_offers.status check constraint with offered not found in catalog (column exists)';
  ELSE
    RAISE NOTICE 'PASS: lead_offers.status constraint includes offered';
  END IF;

  -- Phase 1A–1A.2b prerequisite RPCs
  IF to_regprocedure('wam_ai.get_operational_summary(timestamptz,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing Phase 1A get_operational_summary';
  END IF;
  IF to_regprocedure('wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing Phase 1A.2a recommend_agents_for_lead';
  END IF;
  IF to_regprocedure(
    'wam_ai.create_lead_offer(uuid,text,uuid,text,uuid,uuid,text,text,text,uuid,text,boolean,double precision,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing Phase 1A.2b create_lead_offer';
  END IF;
  RAISE NOTICE 'PASS: Phase 1A–1A.2b prerequisite RPCs present';

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wam_ai_business_readonly') THEN
    RAISE EXCEPTION 'FAIL: wam_ai_business_readonly missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wam_ai_business_actions') THEN
    RAISE EXCEPTION 'FAIL: wam_ai_business_actions missing';
  END IF;
  RAISE NOTICE 'PASS: WAM AI roles exist';
END;
$pre$;

\echo '=== Phase 1A.3 EXPECTED ABSENCE / COLLISION ==='

DO $abs$
DECLARE
  v_hit text[];
BEGIN
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname), ARRAY[]::text[])
  INTO v_hit
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'wam_ai'
    AND p.proname IN (
      'approve_agent','reject_agent','ban_agent','restore_agent','change_agent_dispatch_scope',
      'reject_airtel_registration','mark_airtel_registration_duplicate','cancel_airtel_registration',
      'confirm_airtel_registration_installation','reject_safaricom_registration',
      'mark_safaricom_registration_duplicate','cancel_safaricom_registration',
      'confirm_safaricom_registration_installation','confirm_lead_installation',
      'mark_lead_rejected','mark_lead_duplicate','mark_lead_cancelled','mark_lead_lost',
      'mark_lead_needs_reassignment','revert_lead_pending_install',
      '_resolve_agent_for_action','_resolve_registration_id','_resolve_lead_for_action',
      '_mark_lead_terminal_status','_notification_row_created','action_requests_deny_mutation'
    );
  IF cardinality(v_hit) > 0 THEN
    RAISE EXCEPTION 'FAIL: Phase 1A.3 names already exist (collision): %', array_to_string(v_hit, ', ');
  END IF;
  RAISE NOTICE 'PASS: Phase 1A.3 action names are absent (safe to migrate)';
END;
$abs$;

\echo 'production_verify_phase1a3_pre_pass'
