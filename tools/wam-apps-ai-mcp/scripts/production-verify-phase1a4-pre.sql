-- WAM APPS AI Phase 1A.4 — PRE-MIGRATION production verification
-- Read-only. No row dumps. Fail closed.
-- Usage: psql "$AGENT_HUB_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/production-verify-phase1a4-pre.sql

\echo '=== Phase 1A.4 PRE-MIGRATION BASELINE ==='

DO $pre$
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing public.notifications';
  END IF;
  IF to_regclass('public.device_tokens') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing public.device_tokens';
  END IF;
  IF to_regclass('public.notification_push_receipts') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing public.notification_push_receipts';
  END IF;
  IF to_regclass('wam_ai.action_requests') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing wam_ai.action_requests (Phase 1A.2b prerequisite)';
  END IF;
  IF to_regclass('wam_ai.action_events') IS NULL THEN
    RAISE EXCEPTION 'FAIL: missing wam_ai.action_events (Phase 1A.2b prerequisite)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'agent_id'
  ) THEN RAISE EXCEPTION 'FAIL: notifications.agent_id missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'type'
  ) THEN RAISE EXCEPTION 'FAIL: notifications.type missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'device_tokens' AND column_name = 'token'
  ) THEN RAISE EXCEPTION 'FAIL: device_tokens.token missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'device_tokens' AND column_name = 'is_active'
  ) THEN RAISE EXCEPTION 'FAIL: device_tokens.is_active missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'notifications' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%SYSTEM_ANNOUNCEMENT%'
  ) THEN
    RAISE EXCEPTION 'FAIL: notifications.type must include SYSTEM_ANNOUNCEMENT';
  END IF;

  IF to_regprocedure('wam_ai.send_agent_notification(uuid,text,text,text,text,text,uuid,uuid,text,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: send_agent_notification already exists — wrong migration order or duplicate apply';
  END IF;

  RAISE NOTICE 'PASS: Phase 1A.4 pre-migration baseline OK';
END;
$pre$;
