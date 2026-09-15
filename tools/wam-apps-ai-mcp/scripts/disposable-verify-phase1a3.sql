-- Phase 1A.3 disposable verification (real PostgreSQL RPC behavior on fixture DB only)
\set ON_ERROR_STOP on

\echo '=== approve pending agent ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.approve_agent(
    '55555555-5555-5555-5555-555555555555'::uuid, NULL,
    'a1000001-0000-4000-8000-000000000001'::uuid,
    'b1000001-0000-4000-8000-000000000001'::uuid,
    'test-owner', 'technical_owner', 'Approve pending agent', 'pending');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'approve failed: %', r; END IF;
  IF coalesce((r->'notification_summary'->>'created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'approve notification not verified: %', r->'notification_summary';
  END IF;
END $$;

\echo '=== idempotent replay approve ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.approve_agent(
    '55555555-5555-5555-5555-555555555555'::uuid, NULL,
    'a1000001-0000-4000-8000-000000000001'::uuid,
    'b1000001-0000-4000-8000-000000000001'::uuid,
    'test-owner', 'technical_owner', 'Approve pending agent', 'pending');
  IF coalesce((r->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected idempotent replay: %', r;
  END IF;
END $$;

\echo '=== missing expected_agent_status denied ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.approve_agent(
    'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, NULL,
    'a10000aa-0000-4000-8000-0000000000aa'::uuid,
    'b10000aa-0000-4000-8000-0000000000aa'::uuid,
    'test-owner', 'technical_owner', 'Missing expected', NULL);
  IF r->>'error_category' <> 'validation' THEN RAISE EXCEPTION 'expected validation: %', r; END IF;
END $$;

\echo '=== expected-state conflict ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.reject_agent(
    'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, NULL,
    'a10000ab-0000-4000-8000-0000000000ab'::uuid,
    'b10000ab-0000-4000-8000-0000000000ab'::uuid,
    'test-owner', 'technical_owner', 'Wrong expected', 'approved', NULL);
  IF r->>'error_category' <> 'expected_state_conflict' THEN RAISE EXCEPTION 'expected conflict: %', r; END IF;
END $$;

\echo '=== ban agent reports workload ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.ban_agent(
    '11111111-1111-1111-1111-111111111111'::uuid, NULL,
    'a1000002-0000-4000-8000-000000000002'::uuid,
    'b1000002-0000-4000-8000-000000000002'::uuid,
    'test-owner', 'technical_owner', 'Ban agent', 'approved', NULL);
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'ban failed: %', r; END IF;
  IF r->'outstanding_workload' IS NULL THEN RAISE EXCEPTION 'workload missing: %', r; END IF;
END $$;

\echo '=== restore banned agent ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.restore_agent(
    '99999999-9999-9999-9999-999999999999'::uuid, NULL,
    'a1000003-0000-4000-8000-000000000003'::uuid,
    'b1000003-0000-4000-8000-000000000003'::uuid,
    'test-owner', 'business_partner', 'Restore agent', 'banned');
  IF r->>'resulting_agent_status' <> 'approved' THEN RAISE EXCEPTION 'restore failed: %', r; END IF;
END $$;

\echo '=== change dispatch scope ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.change_agent_dispatch_scope(
    '22222222-2222-2222-2222-222222222222'::uuid, NULL, 'airtel',
    'a1000004-0000-4000-8000-000000000004'::uuid,
    'b1000004-0000-4000-8000-000000000004'::uuid,
    'test-owner', 'technical_owner', 'Enable airtel scope', 'both');
  IF r->>'resulting_dispatch_scope' <> 'airtel' THEN RAISE EXCEPTION 'scope failed: %', r; END IF;
END $$;

\echo '=== confirm lead installation (financial) ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.confirm_lead_installation(
    '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL,
    'a1000005-0000-4000-8000-000000000005'::uuid,
    'b1000005-0000-4000-8000-000000000005'::uuid,
    'test-owner', 'technical_owner', 'Confirm install', 'pending_install');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'confirm lead failed: %', r; END IF;
  IF (r->'financial_effect'->>'changed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'financial changed false: %', r; END IF;
  IF r->'notification_summary'->>'source' <> 'rpc_insert' THEN RAISE EXCEPTION 'notif source: %', r; END IF;
  IF r->'notification_summary'->>'push_delivery' <> 'not_sent_from_rpc' THEN RAISE EXCEPTION 'push claim: %', r; END IF;
END $$;

\echo '=== confirm airtel registration installation ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.confirm_airtel_registration_installation(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, NULL,
    'a1000006-0000-4000-8000-000000000006'::uuid,
    'b1000006-0000-4000-8000-000000000006'::uuid,
    'test-owner', 'technical_owner', 'Confirm reg install', 'pending');
  IF r->>'resulting_registration_status' <> 'installed' THEN RAISE EXCEPTION 'reg install failed: %', r; END IF;
  IF r->'notification_summary'->>'push_delivery' <> 'not_sent_from_rpc' THEN RAISE EXCEPTION 'push claim: %', r; END IF;
END $$;

\echo '=== unauthorized role denied at SQL layer ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.approve_agent(
    'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, NULL,
    'a1000007-0000-4000-8000-000000000007'::uuid,
    'b1000007-0000-4000-8000-000000000007'::uuid,
    'ai-bot', 'ai_service', 'Should fail', 'rejected');
  IF r->>'error_category' <> 'action_not_authorized' THEN RAISE EXCEPTION 'role deny failed: %', r; END IF;
END $$;

\echo '=== active_offer_exists on terminal lead action ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.mark_lead_rejected(
    'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, NULL,
    'a1000008-0000-4000-8000-000000000008'::uuid,
    'b1000008-0000-4000-8000-000000000008'::uuid,
    'test-owner', 'technical_owner', 'Reject offered', 'offered');
  IF r->>'error_category' <> 'active_offer_exists' THEN RAISE EXCEPTION 'active offer: %', r; END IF;
END $$;

\echo '=== commission_present refuses terminal clear ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.mark_lead_rejected(
    'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6'::uuid, NULL,
    'a1000009-0000-4000-8000-000000000009'::uuid,
    'b1000009-0000-4000-8000-000000000009'::uuid,
    'test-owner', 'technical_owner', 'Reject with commission', 'assigned');
  IF r->>'error_category' <> 'commission_present' THEN RAISE EXCEPTION 'commission_present: %', r; END IF;
END $$;

\echo '=== mark_lead_rejected allowed from assigned ==='
DO $$
DECLARE r jsonb; v_assigned uuid;
BEGIN
  r := wam_ai.mark_lead_rejected(
    'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4'::uuid, NULL,
    'a100000a-0000-4000-8000-00000000000a'::uuid,
    'b100000a-0000-4000-8000-00000000000a'::uuid,
    'test-owner', 'technical_owner', 'Reject assigned', 'assigned');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'mark rejected failed: %', r; END IF;
  IF coalesce((r->'financial_effect'->>'changed')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'terminal should not change finance: %', r;
  END IF;
  SELECT assigned_agent_id INTO v_assigned FROM public.inbound_leads WHERE id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
  IF v_assigned IS NULL THEN RAISE EXCEPTION 'assigned_agent_id must not be cleared'; END IF;
END $$;

\echo '=== revert_lead_pending_install from installed (financial) ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.revert_lead_pending_install(
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, NULL,
    'a100000b-0000-4000-8000-00000000000b'::uuid,
    'b100000b-0000-4000-8000-00000000000b'::uuid,
    'test-owner', 'technical_owner', 'Revert installed', 'installed');
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'revert failed: %', r; END IF;
  IF r->>'resulting_lead_status' <> 'pending_install' THEN RAISE EXCEPTION 'revert status: %', r; END IF;
  IF (r->'financial_effect'->>'changed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'revert financial: %', r; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM wam_ai.action_events WHERE idempotency_key = 'a100000b-0000-4000-8000-00000000000b'::uuid
  ) THEN RAISE EXCEPTION 'missing action_events for revert'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM wam_ai.action_requests WHERE idempotency_key = 'a100000b-0000-4000-8000-00000000000b'::uuid
  ) THEN RAISE EXCEPTION 'missing action_requests for revert'; END IF;
END $$;

\echo '=== revert forbidden from rejected ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.revert_lead_pending_install(
    'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5'::uuid, NULL,
    'a100000c-0000-4000-8000-00000000000c'::uuid,
    'b100000c-0000-4000-8000-00000000000c'::uuid,
    'test-owner', 'technical_owner', 'Revert rejected', 'rejected');
  IF r->>'error_category' <> 'invalid_transition' THEN RAISE EXCEPTION 'forbidden revert: %', r; END IF;
END $$;

\echo '=== revert idempotent replay ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.revert_lead_pending_install(
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, NULL,
    'a100000b-0000-4000-8000-00000000000b'::uuid,
    'b100000b-0000-4000-8000-00000000000b'::uuid,
    'test-owner', 'technical_owner', 'Revert installed', 'installed');
  IF coalesce((r->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'revert replay: %', r;
  END IF;
END $$;

\echo '=== audit tables append-only ==='
DO $$
BEGIN
  UPDATE wam_ai.action_events SET outcome = 'tampered' WHERE true;
  RAISE EXCEPTION 'action_events_should_be_immutable';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%action_events_immutable%' THEN RAISE; END IF;
END;
$$;
DO $$
BEGIN
  UPDATE wam_ai.action_requests SET outcome = 'tampered' WHERE true;
  RAISE EXCEPTION 'action_requests_should_be_immutable';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%action_requests_immutable%' THEN RAISE; END IF;
END;
$$;

\echo 'disposable_verify_phase1a3_pass'
