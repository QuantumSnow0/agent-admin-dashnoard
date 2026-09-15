-- Phase 1A.4 agent business-reference hotfix regression (disposable fixture only)
\set ON_ERROR_STOP on

\echo '=== remove prior prefix-collision fixture if present ==='
DELETE FROM public.agent_dispatch_settings
WHERE agent_id = 'f700b74d-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DELETE FROM public.agents
WHERE id = 'f700b74d-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

\echo '=== no min/max uuid aggregates in wam_ai agent resolution ==='
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.prokind = 'f'
      AND coalesce(p.prosrc, '') ~* 'min\s*\(\s*a\.id\s*\)|max\s*\(\s*a\.id\s*\)'
  LOOP
    RAISE EXCEPTION 'unsupported uuid aggregate remains in %', r.sig;
  END LOOP;
END $$;

\echo '=== canonical agent_business_id is uppercase ==='
DO $$
BEGIN
  IF wam_ai.agent_business_id('f700b74d-ac1e-4033-85d0-840df1087698'::uuid) <> 'A-F700B74D' THEN
    RAISE EXCEPTION 'unexpected canonical business id: %',
      wam_ai.agent_business_id('f700b74d-ac1e-4033-85d0-840df1087698'::uuid);
  END IF;
END $$;

\echo '=== normalize accepts mixed case; rejects raw UUID ==='
DO $$
BEGIN
  IF wam_ai.normalize_agent_business_ref('A-f700b74d') <> 'A-F700B74D' THEN
    RAISE EXCEPTION 'normalize mixed case failed';
  END IF;
  IF wam_ai.normalize_agent_business_ref('a-F700B74D') <> 'A-F700B74D' THEN
    RAISE EXCEPTION 'normalize alternate case failed';
  END IF;
  IF wam_ai.normalize_agent_business_ref('f700b74d-ac1e-4033-85d0-840df1087698') IS NOT NULL THEN
    RAISE EXCEPTION 'raw uuid must be rejected';
  END IF;
END $$;

\echo '=== get_agent_details: UUID and safe ref resolve same agent ==='
DO $$
DECLARE
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
BEGIN
  r1 := wam_ai.get_agent_details('f700b74d-ac1e-4033-85d0-840df1087698'::uuid, NULL);
  IF r1->>'status' <> 'success' THEN RAISE EXCEPTION 'uuid lookup failed: %', r1; END IF;

  r2 := wam_ai.get_agent_details(NULL, 'A-f700b74d');
  IF r2->>'status' <> 'success' THEN RAISE EXCEPTION 'safe ref lookup failed: %', r2; END IF;

  r3 := wam_ai.get_agent_details(NULL, 'a-F700B74D');
  IF r3->>'status' <> 'success' THEN RAISE EXCEPTION 'mixed case safe ref failed: %', r3; END IF;

  IF (r1->'agent'->>'agent_id') <> (r2->'agent'->>'agent_id')
     OR (r1->'agent'->>'agent_id') <> (r3->'agent'->>'agent_id') THEN
    RAISE EXCEPTION 'agent_id mismatch across lookups';
  END IF;
END $$;

\echo '=== get_agent_details: both identifiers together ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.get_agent_details(
    'f700b74d-ac1e-4033-85d0-840df1087698'::uuid, 'A-f700b74d');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'dual identifier lookup failed: %', r; END IF;
END $$;

\echo '=== get_agent_details: mismatched internal id and safe ref fails closed ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.get_agent_details(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'A-f700b74d');
  IF r->>'status' <> 'ambiguous' THEN
    RAISE EXCEPTION 'expected ambiguous for mismatched ids, got: %', r;
  END IF;
END $$;

\echo '=== prefix collision returns ambiguous_match ==='
DO $$
DECLARE r jsonb;
  err jsonb;
BEGIN
  INSERT INTO public.agents (id, name, email, airtel_phone, town, status, total_earnings, available_balance)
  VALUES ('f700b74d-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Prefix Collision Agent', 'collision@test.local', '254711000100', 'Nairobi', 'approved', 0, 0)
  ON CONFLICT (id) DO NOTHING;

  r := wam_ai.get_agent_details(NULL, 'A-f700b74d');
  IF r->>'status' <> 'ambiguous' THEN
    RAISE EXCEPTION 'prefix collision must return ambiguous, got: %', r;
  END IF;

  SELECT t.v_error INTO err
  FROM wam_ai._resolve_agent_for_action(NULL, 'A-f700b74d') t;
  IF err->>'error_category' <> 'ambiguous_match' THEN
    RAISE EXCEPTION 'expected ambiguous_match from resolver, got: %', err;
  END IF;

  DELETE FROM public.agents WHERE id = 'f700b74d-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
END $$;

\echo '=== production reproduction: send with internal UUID + expected_recipient_business_id ==='
DO $$
DECLARE r jsonb;
  k uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v_before int;
  v_after int;
BEGIN
  SELECT count(*)::int INTO v_before FROM public.notifications
  WHERE agent_id = 'f700b74d-ac1e-4033-85d0-840df1087698'::uuid
    AND title = 'Kiambu ops ping';

  r := wam_ai.send_agent_notification(
    'f700b74d-ac1e-4033-85d0-840df1087698'::uuid, NULL,
    'Kiambu ops ping', 'Production reproduction case.',
    'SYSTEM_ANNOUNCEMENT', NULL,
    k, c,
    'test-owner', 'technical_owner', 'Send Kiambu briefing', 'approved', 'A-f700b74d');

  IF r->>'status' <> 'success' THEN
    RAISE EXCEPTION 'production reproduction send failed: %', r;
  END IF;
  IF coalesce((r->>'in_app_created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'notification not created: %', r;
  END IF;
  IF r->>'agent_business_id' <> 'A-F700B74D' THEN
    RAISE EXCEPTION 'unexpected agent_business_id in response: %', r->>'agent_business_id';
  END IF;

  SELECT count(*)::int INTO v_after FROM public.notifications
  WHERE agent_id = 'f700b74d-ac1e-4033-85d0-840df1087698'::uuid
    AND title = 'Kiambu ops ping';
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'expected one new notification row, before % after %', v_before, v_after;
  END IF;
END $$;

\echo '=== mismatch expected_recipient creates no notification ==='
DO $$
DECLARE r jsonb;
  k uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v_before int;
  v_after int;
BEGIN
  SELECT count(*)::int INTO v_before FROM public.notifications
  WHERE agent_id = 'f700b74d-ac1e-4033-85d0-840df1087698'::uuid
    AND title = 'Wrong recipient probe';

  r := wam_ai.send_agent_notification(
    'f700b74d-ac1e-4033-85d0-840df1087698'::uuid, NULL,
    'Wrong recipient probe', 'Should not insert.',
    'SYSTEM_ANNOUNCEMENT', NULL,
    k, c,
    'test-owner', 'technical_owner', 'Mismatch probe', 'approved', 'A-AAAAAAAA');

  IF r->>'error_category' <> 'expected_state_conflict' THEN
    RAISE EXCEPTION 'expected expected_state_conflict, got: %', r;
  END IF;

  SELECT count(*)::int INTO v_after FROM public.notifications
  WHERE agent_id = 'f700b74d-ac1e-4033-85d0-840df1087698'::uuid
    AND title = 'Wrong recipient probe';
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'notification row created on mismatch';
  END IF;
END $$;

\echo '=== idempotent replay remains safe ==='
DO $$
DECLARE r1 jsonb;
  r2 jsonb;
  k uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v_title text := 'Idem replay hotfix ' || gen_random_uuid()::text;
  v_before int;
  v_after int;
BEGIN
  SELECT count(*)::int INTO v_before FROM public.notifications
  WHERE agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid AND title = v_title;

  r1 := wam_ai.send_agent_notification(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    v_title, 'Same content replay test.',
    'SYSTEM_ANNOUNCEMENT', NULL,
    k, c,
    'test-owner', 'technical_owner', 'Idem probe', 'approved', 'A-AAAAAAAA');
  IF r1->>'status' <> 'success' THEN RAISE EXCEPTION 'first send failed: %', r1; END IF;

  r2 := wam_ai.send_agent_notification(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    v_title, 'Same content replay test.',
    'SYSTEM_ANNOUNCEMENT', NULL,
    k, c,
    'test-owner', 'technical_owner', 'Idem probe', 'approved', 'A-AAAAAAAA');
  IF coalesce((r2->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected idempotent replay: %', r2;
  END IF;

  SELECT count(*)::int INTO v_after FROM public.notifications
  WHERE agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid AND title = v_title;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'idempotent replay created duplicate notifications: before % after %', v_before, v_after;
  END IF;
END $$;

\echo 'phase1a4_agent_ref_hotfix_pass'
