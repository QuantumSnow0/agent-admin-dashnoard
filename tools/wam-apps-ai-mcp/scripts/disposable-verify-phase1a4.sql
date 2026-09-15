-- Phase 1A.4 disposable verification (fixture DB only)
\set ON_ERROR_STOP on

\echo '=== prepare fresh idempotency keys (action_events are immutable) ==='
DROP TABLE IF EXISTS phase1a4_keys;
CREATE TEMP TABLE phase1a4_keys AS
SELECT
  gen_random_uuid() AS send_key,
  gen_random_uuid() AS send_corr,
  gen_random_uuid() AS deep_key,
  gen_random_uuid() AS deep_corr,
  gen_random_uuid() AS bad_type_key,
  gen_random_uuid() AS bad_type_corr,
  gen_random_uuid() AS bad_deep_key,
  gen_random_uuid() AS bad_deep_corr,
  gen_random_uuid() AS token_key,
  gen_random_uuid() AS token_corr;

\echo '=== send_agent_notification creates in-app row with honest semantics ==='
DO $$
DECLARE r jsonb;
  k record;
BEGIN
  SELECT * INTO k FROM phase1a4_keys;
  r := wam_ai.send_agent_notification(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Ops briefing', 'Please review today''s assignment queue.',
    'SYSTEM_ANNOUNCEMENT', NULL,
    k.send_key, k.send_corr,
    'test-owner', 'technical_owner', 'Send ops briefing', 'approved', NULL);
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'send failed: %', r; END IF;
  IF coalesce((r->>'idempotent_replay')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'first send must not be idempotent replay: %', r;
  END IF;
  IF coalesce((r->>'in_app_created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'in_app_created false: %', r;
  END IF;
  IF coalesce((r->>'push_attempted_by_rpc')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'push_attempted_by_rpc must be false: %', r;
  END IF;
  IF r->>'push_delivery_from_rpc' <> 'not_sent' THEN
    RAISE EXCEPTION 'unexpected push_delivery_from_rpc: %', r;
  END IF;
  IF upper(r->>'notification_reference') !~ '^N-[0-9A-F]{16}$' THEN
    RAISE EXCEPTION 'invalid notification_reference format: %', r->>'notification_reference';
  END IF;
END $$;

\echo '=== idempotent replay send ==='
DO $$
DECLARE r jsonb;
  k record;
BEGIN
  SELECT * INTO k FROM phase1a4_keys;
  r := wam_ai.send_agent_notification(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Ops briefing', 'Please review today''s assignment queue.',
    'SYSTEM_ANNOUNCEMENT', NULL,
    k.send_key, k.send_corr,
    'test-owner', 'technical_owner', 'Send ops briefing', 'approved', NULL);
  IF coalesce((r->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected idempotent replay: %', r;
  END IF;
END $$;

\echo '=== idempotency conflict on changed content creates no new row ==='
DO $$
DECLARE r jsonb;
  k record;
  v_before int;
  v_after int;
BEGIN
  SELECT * INTO k FROM phase1a4_keys;
  SELECT count(*)::int INTO v_before FROM public.notifications
  WHERE agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid AND title = 'Different title';

  r := wam_ai.send_agent_notification(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Different title', 'Please review today''s assignment queue.',
    'SYSTEM_ANNOUNCEMENT', NULL,
    k.send_key, gen_random_uuid(),
    'test-owner', 'technical_owner', 'Conflict test', 'approved', NULL);
  IF r->>'error_category' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'expected idempotency_conflict: %', r;
  END IF;

  SELECT count(*)::int INTO v_after FROM public.notifications
  WHERE agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid AND title = 'Different title';
  IF v_after <> v_before THEN RAISE EXCEPTION 'conflict must not insert notification row'; END IF;
END $$;

\echo '=== invalid notification type rejected ==='
DO $$
DECLARE r jsonb;
  k record;
BEGIN
  SELECT * INTO k FROM phase1a4_keys;
  r := wam_ai.send_agent_notification(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Bad type', 'Body',
    'LEAD_OFFER', NULL,
    k.bad_type_key, k.bad_type_corr,
    'test-owner', 'technical_owner', 'Bad type', 'approved', NULL);
  IF r->>'error_category' <> 'validation' THEN RAISE EXCEPTION 'expected validation: %', r; END IF;
END $$;

\echo '=== deep_link dashboard accepted; external URL rejected ==='
DO $$
DECLARE r jsonb;
  k record;
BEGIN
  SELECT * INTO k FROM phase1a4_keys;
  r := wam_ai.send_agent_notification(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Dashboard link', 'Open the app home.',
    'SYSTEM_ANNOUNCEMENT', 'dashboard',
    k.deep_key, k.deep_corr,
    'test-owner', 'technical_owner', 'Deep link', 'approved', NULL);
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'deep_link send failed: %', r; END IF;

  r := wam_ai.send_agent_notification(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Bad deep', 'Body',
    'SYSTEM_ANNOUNCEMENT', 'https://evil.example',
    k.bad_deep_key, k.bad_deep_corr,
    'test-owner', 'technical_owner', 'Bad deep', 'approved', NULL);
  IF r->>'error_category' <> 'validation' THEN RAISE EXCEPTION 'expected deep_link validation: %', r; END IF;
END $$;

\echo '=== get_agent_notification_history honest delivery fields ==='
DO $$
DECLARE r jsonb;
  n jsonb;
BEGIN
  r := wam_ai.get_agent_notification_history(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    now() - interval '1 day', now(), 10);
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'history failed: %', r; END IF;
  IF coalesce((r->>'result_count')::int, 0) < 1 THEN
    RAISE EXCEPTION 'expected at least one notification: %', r;
  END IF;
  n := (r->'notifications')->0;
  IF n ? 'device_token_available' THEN
    RAISE EXCEPTION 'history must use current_device_token_available not device_token_available';
  END IF;
  IF NOT (n ? 'current_device_token_available') THEN
    RAISE EXCEPTION 'missing current_device_token_available: %', n;
  END IF;
END $$;

\echo '=== delivery status: receipt vs unknown push_attempted ==='
DO $$
DECLARE r jsonb;
  k record;
  v_ref text;
BEGIN
  SELECT * INTO k FROM phase1a4_keys;
  INSERT INTO public.device_tokens (agent_id, token, is_active, device_type)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ExponentPushToken[fixture-only]', true, 'android')
  ON CONFLICT DO NOTHING;

  r := wam_ai.send_agent_notification(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Token probe', 'Checking delivery reporting.',
    'SYSTEM_ANNOUNCEMENT', NULL,
    k.token_key, k.token_corr,
    'test-owner', 'technical_owner', 'Token probe', 'approved', NULL);

  v_ref := r->>'notification_reference';
  r := wam_ai.get_notification_delivery_status(v_ref, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL);
  IF r->>'delivery_status' <> 'unknown' THEN
    RAISE EXCEPTION 'expected unknown without receipt: %', r;
  END IF;
  IF jsonb_typeof(r->'push_attempted') = 'boolean' THEN
    RAISE EXCEPTION 'push_attempted must be unknown (null) without receipt: %', r->'push_attempted';
  END IF;
  IF r ? 'push_delivery' OR r ? 'push_delivery_from_rpc' THEN
    RAISE EXCEPTION 'read must not expose push_delivery fields: %', r;
  END IF;

  INSERT INTO public.notification_push_receipts (notification_id)
  SELECT n.id FROM public.notifications n
  WHERE wam_ai.notification_ref(n.id) = v_ref
  ON CONFLICT DO NOTHING;

  r := wam_ai.get_notification_delivery_status(v_ref, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL);
  IF r->>'delivery_status' <> 'provider_accepted' THEN
    RAISE EXCEPTION 'expected provider_accepted after receipt: %', r;
  END IF;
  IF coalesce((r->>'provider_accepted')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'provider_accepted must be true with receipt: %', r;
  END IF;
  IF coalesce((r->>'delivery_confirmed')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'must not claim delivery_confirmed: %', r;
  END IF;
END $$;

\echo '=== notification_reference ambiguity fails closed ==='
DO $$
DECLARE r jsonb;
  v_id1 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  v_id2 uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbcccc'::uuid;
  v_ref text;
BEGIN
  IF wam_ai.notification_ref(v_id1) <> wam_ai.notification_ref(v_id2) THEN
    RAISE NOTICE 'SKIP ambiguity fixture: refs differ for chosen UUIDs';
    RETURN;
  END IF;

  INSERT INTO public.notifications (id, agent_id, type, title, message, is_read)
  VALUES
    (v_id1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'SYSTEM_ANNOUNCEMENT', 'Amb A', 'A', false),
    (v_id2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'SYSTEM_ANNOUNCEMENT', 'Amb B', 'B', false)
  ON CONFLICT (id) DO NOTHING;

  v_ref := wam_ai.notification_ref(v_id1);
  r := wam_ai.get_notification_delivery_status(v_ref, NULL, NULL);
  IF r->>'error_category' <> 'ambiguous_match' THEN
    RAISE EXCEPTION 'expected ambiguous_match: %', r;
  END IF;
END $$;

\echo '=== raw UUID reference rejected ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.get_notification_delivery_status(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, NULL);
  IF r->>'error_category' <> 'validation' THEN
    RAISE EXCEPTION 'expected validation for raw UUID ref: %', r;
  END IF;
END $$;

\echo 'disposable_verify_phase1a4_pass'
