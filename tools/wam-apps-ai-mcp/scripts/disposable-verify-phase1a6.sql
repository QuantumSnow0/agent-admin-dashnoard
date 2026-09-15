-- Phase 1A.6 disposable verification (fixture DB only — no real SMS)
\set ON_ERROR_STOP on

\echo '=== preview_agent_sms_recipient ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.preview_agent_sms_recipient(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, 'airtel');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'preview failed: %', r; END IF;
  IF r->>'masked_destination' IS NULL THEN RAISE EXCEPTION 'missing masked: %', r; END IF;
  IF r->>'destination_fingerprint' IS NULL THEN RAISE EXCEPTION 'missing fingerprint: %', r; END IF;
  IF r ? 'normalized_destination' THEN RAISE EXCEPTION 'must not expose full MSISDN: %', r; END IF;
END $$;

\echo '=== prepare + finalize happy path (no provider HTTP) ==='
DO $$
DECLARE
  r jsonb;
  fin jsonb;
  prev jsonb;
  k uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v_fp text;
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, 'airtel');
  v_fp := prev->>'destination_fingerprint';

  r := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Ops briefing for today.', 'airtel',
    k, c, 'test-owner', 'technical_owner', 'Send SMS',
    'approved', 'A-AAAAAAAA', v_fp);
  IF r->>'status' <> 'ready' THEN RAISE EXCEPTION 'prepare failed: %', r; END IF;
  IF r->>'normalized_destination' IS NULL THEN RAISE EXCEPTION 'prepare missing msisdn for MCP: %', r; END IF;

  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', 'technical_owner',
    'provider_accepted', 'mock-1', NULL, NULL, true,
    'Ops briefing for today.');
  IF fin->>'status' <> 'success' THEN RAISE EXCEPTION 'finalize failed: %', fin; END IF;
  IF coalesce((fin->>'provider_accepted')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected provider_accepted: %', fin;
  END IF;
  IF coalesce((fin->>'delivery_confirmed')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'delivery_confirmed must be false: %', fin;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      AND metadata->>'channel' = 'sms'
      AND metadata->>'sms_reference' = fin->>'sms_reference'
  ) THEN
    RAISE EXCEPTION 'missing in-app SMS copy';
  END IF;
END $$;

\echo '=== idempotent prepare replay ==='
DO $$
DECLARE
  r1 jsonb; r2 jsonb; fin jsonb; prev jsonb;
  k uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v_fp text;
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, 'airtel');
  v_fp := prev->>'destination_fingerprint';
  r1 := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Idem SMS body', 'airtel',
    k, c, 'test-owner', 'technical_owner', 'Idem',
    'approved', 'A-AAAAAAAA', v_fp);
  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', 'technical_owner',
    'provider_accepted', 'mock-2', NULL, NULL, true, 'Idem SMS body');
  IF fin->>'status' <> 'success' THEN RAISE EXCEPTION 'first finalize failed: %', fin; END IF;

  r2 := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Idem SMS body', 'airtel',
    k, c, 'test-owner', 'technical_owner', 'Idem',
    'approved', 'A-AAAAAAAA', v_fp);
  IF coalesce((r2->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected idempotent replay: %', r2;
  END IF;
END $$;

\echo '=== changed content conflicts ==='
DO $$
DECLARE
  r jsonb; prev jsonb;
  k uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v_fp text;
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, 'airtel');
  v_fp := prev->>'destination_fingerprint';
  r := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Original body', 'airtel',
    k, c, 'test-owner', 'technical_owner', 'Conflict',
    'approved', 'A-AAAAAAAA', v_fp);
  PERFORM wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', 'technical_owner',
    'provider_accepted', 'mock-3', NULL, NULL, false, 'Original body');

  r := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Different body', 'airtel',
    k, c, 'test-owner', 'technical_owner', 'Conflict',
    'approved', 'A-AAAAAAAA', v_fp);
  IF r->>'error_category' <> 'idempotency_conflict' THEN
    RAISE EXCEPTION 'expected idempotency_conflict: %', r;
  END IF;
END $$;

\echo '=== partner role allowed at SQL for prepare ==='
DO $$
DECLARE r jsonb; prev jsonb; k uuid := gen_random_uuid(); c uuid := gen_random_uuid();
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, 'airtel');
  r := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Partner attempt', 'airtel',
    k, c, 'partner', 'business_partner', 'Yes partner',
    'approved', 'A-AAAAAAAA', prev->>'destination_fingerprint');
  IF r->>'status' NOT IN ('ready', 'success') THEN
    RAISE EXCEPTION 'partner must be allowed for prepare: %', r;
  END IF;
END $$;

\echo '=== ai_service role denied at SQL ==='
DO $$
DECLARE r jsonb; prev jsonb; k uuid := gen_random_uuid(); c uuid := gen_random_uuid();
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, 'airtel');
  r := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'AI service attempt', 'airtel',
    k, c, 'ai-bot', 'ai_service', 'No',
    'approved', 'A-AAAAAAAA', prev->>'destination_fingerprint');
  IF r->>'error_category' <> 'action_not_authorized' THEN
    RAISE EXCEPTION 'ai_service must be denied: %', r;
  END IF;
END $$;

\echo '=== stale destination fingerprint ==='
DO $$
DECLARE r jsonb; k uuid := gen_random_uuid(); c uuid := gen_random_uuid();
BEGIN
  r := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Stale dest', 'airtel',
    k, c, 'test-owner', 'technical_owner', 'Stale',
    'approved', 'A-AAAAAAAA', repeat('a', 64));
  IF r->>'error_category' <> 'expected_state_conflict' THEN
    RAISE EXCEPTION 'expected dest conflict: %', r;
  END IF;
END $$;

\echo '=== get_sms_delivery_status ==='
DO $$
DECLARE r jsonb; prev jsonb; prep jsonb; fin jsonb;
  k uuid := gen_random_uuid(); c uuid := gen_random_uuid();
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, 'airtel');
  prep := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'Status check body', 'airtel',
    k, c, 'test-owner', 'technical_owner', 'Status',
    'approved', 'A-AAAAAAAA', prev->>'destination_fingerprint');
  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', 'technical_owner',
    'provider_accepted', 'mock-status', NULL, NULL, true, 'Status check body');
  r := wam_ai.get_sms_delivery_status(fin->>'sms_reference', NULL, NULL);
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'delivery status failed: %', r; END IF;
  IF coalesce((r->>'delivery_confirmed')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'delivery_confirmed must be false: %', r;
  END IF;
END $$;

\echo '=== get_agent_sms_history ==='
DO $$
DECLARE r jsonb; prep jsonb; fin jsonb;
  k uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  prev jsonb;
BEGIN
  prev := wam_ai.preview_agent_sms_recipient(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, 'airtel');
  prep := wam_ai.prepare_send_agent_sms(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'History probe body', 'airtel',
    k, c, 'test-owner', 'technical_owner', 'History',
    'approved', 'A-AAAAAAAA', prev->>'destination_fingerprint');
  fin := wam_ai.finalize_send_agent_sms(
    k, c, 'test-owner', 'technical_owner',
    'provider_accepted', 'mock-history', NULL, NULL, true, 'History probe body');
  r := wam_ai.get_agent_sms_history(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL, NULL, NULL, 10);
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'history failed: %', r; END IF;
  IF coalesce((r->>'result_count')::int, 0) < 1 THEN
    RAISE EXCEPTION 'expected at least one history row: %', r;
  END IF;
END $$;

\echo 'disposable_verify_phase1a6_pass'
