-- Phase 1A.5 disposable verification (fixture DB only)
\set ON_ERROR_STOP on

DROP TABLE IF EXISTS phase1a5_keys;
CREATE TEMP TABLE phase1a5_keys AS
SELECT
  gen_random_uuid() AS kyc_key,
  gen_random_uuid() AS kyc_corr,
  gen_random_uuid() AS pending_key,
  gen_random_uuid() AS pending_corr,
  gen_random_uuid() AS expire_key,
  gen_random_uuid() AS expire_corr,
  gen_random_uuid() AS agent_pending_key,
  gen_random_uuid() AS fallback_key,
  gen_random_uuid() AS radius_key,
  gen_random_uuid() AS reopen_airtel_key,
  gen_random_uuid() AS reopen_safi_key;

\echo '=== mark_lead_kyc_completed ==='
DO $$
DECLARE r jsonb; k record;
BEGIN
  SELECT * INTO k FROM phase1a5_keys;
  r := wam_ai.mark_lead_kyc_completed(
    'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, NULL,
    k.kyc_key, k.kyc_corr,
    'test-owner', 'technical_owner', 'KYC complete', 'assigned');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'kyc failed: %', r; END IF;
  IF r->>'resulting_lead_status' <> 'kyc_completed' THEN RAISE EXCEPTION 'bad status: %', r; END IF;
END $$;

\echo '=== mark_lead_pending_install ==='
DO $$
DECLARE r jsonb; k record;
BEGIN
  SELECT * INTO k FROM phase1a5_keys;
  r := wam_ai.mark_lead_pending_install(
    'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, NULL,
    k.pending_key, k.pending_corr,
    'test-owner', 'technical_owner', 'Schedule install', 'kyc_completed');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'pending_install failed: %', r; END IF;
  IF r->>'resulting_lead_status' <> 'pending_install' THEN RAISE EXCEPTION 'bad status: %', r; END IF;
END $$;

\echo '=== expire_lead_offer ==='
DO $$
DECLARE r jsonb; k record;
BEGIN
  SELECT * INTO k FROM phase1a5_keys;
  r := wam_ai.expire_lead_offer(
    'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3'::uuid, NULL,
    k.expire_key, k.expire_corr,
    'test-owner', 'technical_owner', 'Expire stuck offer', 'offered');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'expire failed: %', r; END IF;
  IF r->>'resulting_offer_status' <> 'expired' THEN RAISE EXCEPTION 'offer not expired: %', r; END IF;
END $$;

\echo '=== set_agent_pending ==='
DO $$
DECLARE r jsonb; k record;
BEGIN
  SELECT * INTO k FROM phase1a5_keys;
  r := wam_ai.set_agent_pending(
    '44444444-4444-4444-4444-444444444444'::uuid, NULL,
    k.agent_pending_key, gen_random_uuid(),
    'test-owner', 'technical_owner', 'Set pending review', 'approved');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'set pending failed: %', r; END IF;
  IF r->>'resulting_agent_status' <> 'pending' THEN RAISE EXCEPTION 'agent not pending: %', r; END IF;
END $$;

\echo '=== set_agent_fallback_dispatch ==='
DO $$
DECLARE r jsonb; k record;
BEGIN
  SELECT * INTO k FROM phase1a5_keys;
  r := wam_ai.set_agent_fallback_dispatch(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL,
    true, 50,
    k.fallback_key, gen_random_uuid(),
    'test-owner', 'technical_owner', 'Enable fallback');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'fallback failed: %', r; END IF;
  IF coalesce((r->>'is_fallback_agent')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'fallback not set: %', r;
  END IF;
END $$;

\echo '=== set_agent_service_radius ==='
DO $$
DECLARE r jsonb; k record;
BEGIN
  SELECT * INTO k FROM phase1a5_keys;
  r := wam_ai.set_agent_service_radius(
    '22222222-2222-2222-2222-222222222222'::uuid, NULL,
    12.3, false,
    k.radius_key, gen_random_uuid(),
    'test-owner', 'technical_owner', 'Set radius');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'radius failed: %', r; END IF;
  IF (r->>'service_radius_km')::float <> 12.3 THEN RAISE EXCEPTION 'radius mismatch: %', r; END IF;
END $$;

\echo '=== reopen registrations ==='
DO $$
DECLARE r jsonb; k record;
  v_airtel uuid := 'a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5';
  v_safi uuid := 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6';
BEGIN
  SELECT * INTO k FROM phase1a5_keys;
  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, installation_town, created_at
  ) VALUES (
    v_airtel, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Reopen Airtel', '254799000201', 'rejected', 'Nairobi', now()
  ) ON CONFLICT (id) DO UPDATE SET status = 'rejected';

  INSERT INTO public.safaricom_registrations (id, agent_id, status, created_at)
  VALUES (v_safi, 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'cancelled', now())
  ON CONFLICT (id) DO UPDATE SET status = 'cancelled';

  r := wam_ai.reopen_airtel_registration_pending(
    v_airtel, NULL, k.reopen_airtel_key, gen_random_uuid(),
    'test-owner', 'technical_owner', 'Reopen airtel', 'rejected');
  IF r->>'resulting_registration_status' <> 'pending' THEN RAISE EXCEPTION 'airtel reopen: %', r; END IF;

  r := wam_ai.reopen_safaricom_registration_pending(
    v_safi, NULL, k.reopen_safi_key, gen_random_uuid(),
    'test-owner', 'technical_owner', 'Reopen safaricom', 'cancelled');
  IF r->>'resulting_registration_status' <> 'pending' THEN RAISE EXCEPTION 'safaricom reopen: %', r; END IF;
END $$;

\echo '=== expected-state mismatch denied ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.mark_lead_kyc_completed(
    '88888888-8888-8888-8888-888888888888'::uuid, NULL,
    gen_random_uuid(), gen_random_uuid(),
    'test-owner', 'technical_owner', 'Bad expected', 'offered');
  IF r->>'error_category' <> 'expected_state_conflict' THEN
    RAISE EXCEPTION 'expected conflict missing: %', r;
  END IF;
END $$;

\echo '=== mark_lead_pending_install refuses commission_present ==='
DO $$
DECLARE r jsonb;
  v_comm numeric;
  v_status text;
BEGIN
  UPDATE public.inbound_leads
  SET status = 'kyc_completed', commission_earned_ksh = 150, installed_at = NULL
  WHERE id = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';

  r := wam_ai.mark_lead_pending_install(
    'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5'::uuid, NULL,
    gen_random_uuid(), gen_random_uuid(),
    'test-owner', 'technical_owner', 'Should refuse', 'kyc_completed');

  IF r->>'error_category' <> 'commission_present' THEN
    RAISE EXCEPTION 'commission_present expected: %', r;
  END IF;

  SELECT commission_earned_ksh, status INTO v_comm, v_status
  FROM public.inbound_leads WHERE id = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';
  IF v_comm IS DISTINCT FROM 150::numeric OR v_status <> 'kyc_completed' THEN
    RAISE EXCEPTION 'partial mutation on refusal: comm=% status=%', v_comm, v_status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM wam_ai.action_events
    WHERE operation_name = 'mark_lead_pending_install'
      AND lead_ref = wam_ai.lead_ref('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5'::uuid)
      AND outcome = 'success'
  ) THEN
    RAISE EXCEPTION 'success audit must not be written on commission refusal';
  END IF;
END $$;

\echo '=== mark_lead_pending_install preserves NULL financial fields ==='
DO $$
DECLARE r jsonb;
  v_comm numeric;
  v_installed timestamptz;
BEGIN
  UPDATE public.inbound_leads
  SET status = 'kyc_completed', commission_earned_ksh = NULL, installed_at = NULL
  WHERE id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';

  r := wam_ai.mark_lead_pending_install(
    'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, NULL,
    gen_random_uuid(), gen_random_uuid(),
    'test-owner', 'technical_owner', 'Clean pending', 'kyc_completed');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'clean pending failed: %', r; END IF;

  SELECT commission_earned_ksh, installed_at INTO v_comm, v_installed
  FROM public.inbound_leads WHERE id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
  IF v_comm IS NOT NULL OR v_installed IS NOT NULL THEN
    RAISE EXCEPTION 'financial columns mutated: comm=% installed=%', v_comm, v_installed;
  END IF;
  IF (r->'financial_effect'->>'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'financial_effect.changed must be false: %', r;
  END IF;
END $$;

\echo '=== business_partner allowed for set_agent_fallback_dispatch ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.set_agent_fallback_dispatch(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL,
    true, 10,
    gen_random_uuid(), gen_random_uuid(),
    'test-partner', 'business_partner', 'Partner fallback ok');
  IF r->>'status' <> 'success' THEN
    RAISE EXCEPTION 'partner must be allowed fallback: %', r;
  END IF;
END $$;

\echo '=== ai_service denied for set_agent_fallback_dispatch ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.set_agent_fallback_dispatch(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL,
    false, 0,
    gen_random_uuid(), gen_random_uuid(),
    'ai-bot', 'ai_service', 'Should fail');
  IF r->>'error_category' <> 'action_not_authorized' THEN
    RAISE EXCEPTION 'ai_service must be denied fallback: %', r;
  END IF;
END $$;

\echo '=== reopen refuses linked lead commission ==='
DO $$
DECLARE r jsonb;
  v_reg uuid := 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7';
BEGIN
  INSERT INTO public.inbound_leads (
    id, customer_name, primary_phone, status, source, product, county, installation_town,
    assigned_agent_id, dedupe_phone_key, commission_earned_ksh
  ) VALUES (
    'd7d7d7d7-d7d7-d7d7-d7d7-d7d7d7d7d7d7', 'Linked Lead', '254799000301', 'rejected',
    'airtel5grouter', 'airtel', 'Nairobi', 'Nairobi',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dedupe-linked-comm', 200
  ) ON CONFLICT (id) DO UPDATE SET commission_earned_ksh = 200, status = 'rejected';

  INSERT INTO public.customer_registrations (
    id, agent_id, inbound_lead_id, customer_name, airtel_number, status, installation_town, created_at
  ) VALUES (
    v_reg, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'd7d7d7d7-d7d7-d7d7-d7d7-d7d7d7d7d7d7', 'Linked Reg', '254799000302', 'rejected', 'Nairobi', now()
  ) ON CONFLICT (id) DO UPDATE SET status = 'rejected', inbound_lead_id = EXCLUDED.inbound_lead_id;

  r := wam_ai.reopen_airtel_registration_pending(
    v_reg, NULL, gen_random_uuid(), gen_random_uuid(),
    'test-owner', 'technical_owner', 'Should refuse linked commission', 'rejected');
  IF r->>'error_category' NOT IN ('commission_present', 'financial_state_present') THEN
    RAISE EXCEPTION 'linked commission reopen refused: %', r;
  END IF;
END $$;

\echo 'disposable_verify_phase1a5_pass'
