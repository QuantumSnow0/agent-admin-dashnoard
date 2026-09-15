-- Phase 1A.6 finalize reservation-binding remediation (disposable only)
\set ON_ERROR_STOP on

\echo '=== finalize reservation binding: refuse mismatched correlation/actor/role ==='
DO $$
DECLARE
  agent uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  prev jsonb;
  prep jsonb;
  fin jsonb;
  k uuid;
  c uuid;
  body text;
  n_before int;
  e_before int;
  r_before int;
  i_status text;
  n_after int;
  e_after int;
  r_after int;
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(agent, NULL, 'airtel');
  IF prev->>'status' <> 'success' THEN RAISE EXCEPTION 'preview failed: %', prev; END IF;

  -- mismatched correlation_id
  k := gen_random_uuid(); c := gen_random_uuid(); body := 'Binding probe correlation ' || k::text;
  prep := wam_ai.prepare_send_agent_sms(
    agent, NULL, body, 'airtel', k, c, 'test-owner', 'technical_owner', 'Bind corr',
    'approved', 'A-AAAAAAAA', prev->>'destination_fingerprint');
  IF prep->>'status' <> 'ready' THEN RAISE EXCEPTION 'prepare failed: %', prep; END IF;

  SELECT count(*)::int INTO n_before FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_before FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_before FROM wam_ai.action_requests WHERE idempotency_key = k;

  fin := wam_ai.finalize_send_agent_sms(
    k, gen_random_uuid(), 'test-owner', 'technical_owner',
    'provider_accepted', 'should-not-apply', NULL, NULL, true, body);
  IF fin->>'error_category' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'expected correlation mismatch conflict: %', fin;
  END IF;
  IF coalesce((fin->>'provider_accepted')::boolean, false) THEN
    RAISE EXCEPTION 'must not report provider acceptance on refusal: %', fin;
  END IF;
  SELECT status INTO i_status FROM wam_ai.sms_send_intents WHERE idempotency_key = k;
  IF i_status <> 'reserved' THEN RAISE EXCEPTION 'intent mutated on corr mismatch: %', i_status; END IF;
  SELECT count(*)::int INTO n_after FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_after FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_after FROM wam_ai.action_requests WHERE idempotency_key = k;
  IF n_after <> n_before OR e_after <> e_before OR r_after <> r_before THEN
    RAISE EXCEPTION 'mutation after correlation refusal n=%->% e=%->% r=%->%',
      n_before, n_after, e_before, e_after, r_before, r_after;
  END IF;
  DELETE FROM wam_ai.sms_send_intents WHERE idempotency_key = k;

  -- mismatched actor_id
  k := gen_random_uuid(); c := gen_random_uuid(); body := 'Binding probe actor ' || k::text;
  prep := wam_ai.prepare_send_agent_sms(
    agent, NULL, body, 'airtel', k, c, 'test-owner', 'technical_owner', 'Bind actor',
    'approved', 'A-AAAAAAAA', prev->>'destination_fingerprint');
  SELECT count(*)::int INTO n_before FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_before FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_before FROM wam_ai.action_requests WHERE idempotency_key = k;

  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'other-owner', 'technical_owner',
    'provider_accepted', 'should-not-apply', NULL, NULL, true, body);
  IF fin->>'error_category' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'expected actor mismatch conflict: %', fin;
  END IF;
  SELECT status INTO i_status FROM wam_ai.sms_send_intents WHERE idempotency_key = k;
  IF i_status <> 'reserved' THEN RAISE EXCEPTION 'intent mutated on actor mismatch: %', i_status; END IF;
  SELECT count(*)::int INTO n_after FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_after FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_after FROM wam_ai.action_requests WHERE idempotency_key = k;
  IF n_after <> n_before OR e_after <> e_before OR r_after <> r_before THEN
    RAISE EXCEPTION 'mutation after actor refusal';
  END IF;
  DELETE FROM wam_ai.sms_send_intents WHERE idempotency_key = k;

  -- mismatched actor_role (partner finalize against owner reservation)
  k := gen_random_uuid(); c := gen_random_uuid(); body := 'Binding probe role ' || k::text;
  prep := wam_ai.prepare_send_agent_sms(
    agent, NULL, body, 'airtel', k, c, 'test-owner', 'technical_owner', 'Bind role',
    'approved', 'A-AAAAAAAA', prev->>'destination_fingerprint');
  SELECT count(*)::int INTO n_before FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_before FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_before FROM wam_ai.action_requests WHERE idempotency_key = k;

  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', 'business_partner',
    'provider_accepted', 'should-not-apply', NULL, NULL, true, body);
  IF fin->>'error_category' <> 'action_not_authorized' THEN
    RAISE EXCEPTION 'expected action_not_authorized for partner finalize: %', fin;
  END IF;
  SELECT status INTO i_status FROM wam_ai.sms_send_intents WHERE idempotency_key = k;
  IF i_status <> 'reserved' THEN RAISE EXCEPTION 'intent mutated on role mismatch: %', i_status; END IF;
  SELECT count(*)::int INTO n_after FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_after FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_after FROM wam_ai.action_requests WHERE idempotency_key = k;
  IF n_after <> n_before OR e_after <> e_before OR r_after <> r_before THEN
    RAISE EXCEPTION 'mutation after role refusal';
  END IF;
  DELETE FROM wam_ai.sms_send_intents WHERE idempotency_key = k;

  -- null actor_role
  k := gen_random_uuid(); c := gen_random_uuid(); body := 'Binding probe null role ' || k::text;
  prep := wam_ai.prepare_send_agent_sms(
    agent, NULL, body, 'airtel', k, c, 'test-owner', 'technical_owner', 'Bind null role',
    'approved', 'A-AAAAAAAA', prev->>'destination_fingerprint');
  SELECT count(*)::int INTO n_before FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_before FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_before FROM wam_ai.action_requests WHERE idempotency_key = k;

  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', NULL,
    'provider_accepted', 'should-not-apply', NULL, NULL, true, body);
  IF fin->>'error_category' <> 'action_not_authorized' THEN
    RAISE EXCEPTION 'expected action_not_authorized for null role: %', fin;
  END IF;
  SELECT status INTO i_status FROM wam_ai.sms_send_intents WHERE idempotency_key = k;
  IF i_status <> 'reserved' THEN RAISE EXCEPTION 'intent mutated on null role: %', i_status; END IF;
  SELECT count(*)::int INTO n_after FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_after FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_after FROM wam_ai.action_requests WHERE idempotency_key = k;
  IF n_after <> n_before OR e_after <> e_before OR r_after <> r_before THEN
    RAISE EXCEPTION 'mutation after null-role refusal';
  END IF;
  DELETE FROM wam_ai.sms_send_intents WHERE idempotency_key = k;
END $$;

\echo '=== poisoned non-technical_owner reservation cannot finalize ==='
DO $$
DECLARE
  agent uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  prev jsonb;
  fin jsonb;
  k uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  n_before int;
  e_before int;
  r_before int;
  n_after int;
  e_after int;
  r_after int;
  i_status text;
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(agent, NULL, 'airtel');
  INSERT INTO wam_ai.sms_send_intents (
    idempotency_key, correlation_id, actor_id, actor_role, request_fingerprint,
    agent_id, agent_business_ref, phone_target, destination_fingerprint,
    masked_destination, message_fingerprint, message_length, encoding,
    estimated_segments, status, sms_ref
  ) VALUES (
    k, c, 'ai-actor', 'ai_service', repeat('f', 64),
    agent, 'A-AAAAAAAA', 'airtel', prev->>'destination_fingerprint',
    prev->>'masked_destination', repeat('a', 64), 12, 'gsm7_estimate',
    1, 'reserved', wam_ai.sms_ref(k)
  );

  SELECT count(*)::int INTO n_before FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_before FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_before FROM wam_ai.action_requests WHERE idempotency_key = k;

  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'ai-actor', 'ai_service',
    'provider_accepted', 'poison', NULL, NULL, true, 'Poisoned body');
  IF fin->>'error_category' <> 'action_not_authorized' THEN
    RAISE EXCEPTION 'poisoned non-technical_owner (ai_service) reservation must be refused: %', fin;
  END IF;

  -- owner cannot finalize a non-gateway reservation either
  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', 'technical_owner',
    'provider_accepted', 'poison2', NULL, NULL, true, 'Poisoned body');
  IF fin->>'error_category' NOT IN ('action_not_authorized', 'idempotency_conflict') THEN
    RAISE EXCEPTION 'owner finalize of ai_service reservation must refuse: %', fin;
  END IF;

  SELECT status INTO i_status FROM wam_ai.sms_send_intents WHERE idempotency_key = k;
  IF i_status <> 'reserved' THEN RAISE EXCEPTION 'poisoned intent mutated: %', i_status; END IF;
  SELECT count(*)::int INTO n_after FROM public.notifications
  WHERE agent_id = agent AND metadata->>'channel' = 'sms';
  SELECT count(*)::int INTO e_after FROM wam_ai.action_events WHERE idempotency_key = k;
  SELECT count(*)::int INTO r_after FROM wam_ai.action_requests WHERE idempotency_key = k;
  IF n_after <> n_before OR e_after <> e_before OR r_after <> r_before THEN
    RAISE EXCEPTION 'mutation after poisoned-reservation refusal';
  END IF;
  DELETE FROM wam_ai.sms_send_intents WHERE idempotency_key = k;
END $$;

\echo '=== valid matching finalization + audit uses reservation identity ==='
DO $$
DECLARE
  agent uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  prev jsonb;
  prep jsonb;
  fin jsonb;
  replay jsonb;
  k uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  body text := 'Valid binding finalize ' || k::text;
  evt wam_ai.action_events%ROWTYPE;
  req wam_ai.action_requests%ROWTYPE;
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(agent, NULL, 'airtel');
  prep := wam_ai.prepare_send_agent_sms(
    agent, NULL, body, 'airtel', k, c, 'test-owner', 'technical_owner', 'Valid bind',
    'approved', 'A-AAAAAAAA', prev->>'destination_fingerprint');
  IF prep->>'status' <> 'ready' THEN RAISE EXCEPTION 'prepare failed: %', prep; END IF;

  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', 'technical_owner',
    'provider_accepted', 'mock-bound-ok', NULL, NULL, true, body);
  IF fin->>'status' <> 'success' THEN RAISE EXCEPTION 'valid finalize failed: %', fin; END IF;
  IF coalesce((fin->>'provider_accepted')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected provider_accepted: %', fin;
  END IF;
  IF coalesce((fin->>'delivery_confirmed')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'delivery_confirmed must be false: %', fin;
  END IF;
  IF (fin->>'correlation_id')::uuid IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'result correlation must be reservation value: %', fin;
  END IF;

  SELECT * INTO evt FROM wam_ai.action_events WHERE idempotency_key = k;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing action_event'; END IF;
  IF evt.correlation_id IS DISTINCT FROM c
     OR evt.actor_id IS DISTINCT FROM 'test-owner'
     OR evt.actor_role IS DISTINCT FROM 'technical_owner' THEN
    RAISE EXCEPTION 'action_event must use reservation identity: % % %',
      evt.correlation_id, evt.actor_id, evt.actor_role;
  END IF;

  SELECT * INTO req FROM wam_ai.action_requests WHERE idempotency_key = k;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing action_request'; END IF;
  IF req.correlation_id IS DISTINCT FROM c
     OR req.actor_id IS DISTINCT FROM 'test-owner'
     OR req.actor_role IS DISTINCT FROM 'technical_owner' THEN
    RAISE EXCEPTION 'action_request must use reservation identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE agent_id = agent
      AND metadata->>'channel' = 'sms'
      AND metadata->>'sms_reference' = fin->>'sms_reference'
      AND (metadata->>'correlation_id')::uuid = c
  ) THEN
    RAISE EXCEPTION 'notification missing or wrong correlation';
  END IF;

  replay := wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', 'technical_owner',
    'provider_accepted', 'mock-bound-replay', NULL, NULL, true, body);
  IF coalesce((replay->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected idempotent replay: %', replay;
  END IF;
END $$;

\echo 'phase1a6_finalize_reservation_binding_pass'
