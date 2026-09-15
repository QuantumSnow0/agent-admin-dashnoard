-- Disposable Phase 1A.2b verification (run after apply-disposable-fixture with action role)
\set ON_ERROR_STOP on

\echo '=== action privilege gate ==='
\i scripts/action-privilege-gate.sql

\echo '=== readonly cannot execute create_lead_offer ==='
SELECT has_function_privilege(
  'wam_ai_business_readonly',
  'wam_ai.create_lead_offer(uuid,text,uuid,text,uuid,uuid,text,text,text,uuid,text,boolean,double precision,text)',
  'EXECUTE'
) AS readonly_can_create;

\echo '=== action role direct table mutation must fail ==='
SET ROLE wam_ai_business_actions;
DO $t$
BEGIN
  BEGIN
    UPDATE public.inbound_leads SET status = 'lost' WHERE id = '77777777-7777-7777-7777-777777777777';
    RAISE EXCEPTION 'verify_fail: action role can UPDATE inbound_leads directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'verify_pass: direct inbound_leads UPDATE denied';
  END;
END;
$t$;
RESET ROLE;

\echo '=== valid synthetic offer creation ==='
SELECT (wam_ai.create_lead_offer(
  '77777777-7777-7777-7777-777777777777'::uuid,
  NULL,
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001'::uuid,
  'fixture_actor',
  'technical_owner',
  'Disposable rehearsal offer',
  NULL, 'admin_queue', true, 0.0, NULL
)->>'status') AS create_status,
  (wam_ai.create_lead_offer(
  '77777777-7777-7777-7777-777777777777'::uuid,
  NULL,
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001'::uuid,
  'fixture_actor',
  'technical_owner',
  'Disposable rehearsal offer',
  NULL, 'admin_queue', true, 0.0, NULL
)->>'offer_ref') AS offer_ref;

\echo '=== lead not directly assigned ==='
SELECT status, assigned_agent_id IS NULL AS unassigned
FROM public.inbound_leads WHERE id = '77777777-7777-7777-7777-777777777777';

\echo '=== offer awaiting agent response ==='
SELECT status, agent_id
FROM public.lead_offers
WHERE lead_id = '77777777-7777-7777-7777-777777777777'
ORDER BY created_at DESC LIMIT 1;

\echo '=== idempotent replay ==='
SELECT (wam_ai.create_lead_offer(
  '77777777-7777-7777-7777-777777777777'::uuid,
  NULL,
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002'::uuid,
  'fixture_actor',
  'technical_owner',
  'Replay test',
  NULL, NULL, NULL, NULL, NULL
)->>'idempotent_replay') AS replay_flag;

\echo '=== idempotency conflict ==='
SELECT (wam_ai.create_lead_offer(
  '77777777-7777-7777-7777-777777777777'::uuid,
  NULL,
  '22222222-2222-2222-2222-222222222222'::uuid,
  NULL,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb003'::uuid,
  'fixture_actor',
  'technical_owner',
  'Conflict test',
  NULL, NULL, NULL, NULL, NULL
)->>'error_category') AS conflict_category;

\echo '=== active offer prevents duplicate ==='
SELECT (wam_ai.create_lead_offer(
  '77777777-7777-7777-7777-777777777777'::uuid,
  NULL,
  '22222222-2222-2222-2222-222222222222'::uuid,
  NULL,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0002'::uuid,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb004'::uuid,
  'fixture_actor',
  'technical_owner',
  'Duplicate should fail',
  NULL, NULL, NULL, NULL, NULL
)->>'error_category') AS active_offer_error;

\echo '=== action_events_deny_mutation EXECUTE denied ==='
SELECT has_function_privilege('public', 'wam_ai.action_events_deny_mutation()', 'EXECUTE') AS public_can_exec,
       has_function_privilege('anon', 'wam_ai.action_events_deny_mutation()', 'EXECUTE') AS anon_can_exec,
       has_function_privilege('authenticated', 'wam_ai.action_events_deny_mutation()', 'EXECUTE') AS auth_can_exec,
       has_function_privilege('wam_ai_business_readonly', 'wam_ai.action_events_deny_mutation()', 'EXECUTE') AS readonly_can_exec,
       has_function_privilege('wam_ai_business_actions', 'wam_ai.action_events_deny_mutation()', 'EXECUTE') AS actions_can_exec;

\echo '=== action_events immutability trigger still active after EXECUTE revoke ==='
DO $immut$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM wam_ai.action_events LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'verify_fail: no action_events row for immutability test';
  END IF;
  BEGIN
    UPDATE wam_ai.action_events SET outcome = 'tampered' WHERE id = v_id;
    RAISE EXCEPTION 'verify_fail: action_events UPDATE was not blocked by trigger';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%action_events_immutable%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'verify_pass: action_events immutability trigger active';
  END;
END;
$immut$;

\echo '=== action audit records ==='
SELECT count(*)::int AS action_events FROM wam_ai.action_events;
SELECT count(*)::int AS action_requests FROM wam_ai.action_requests;

\echo 'disposable_verify_phase1a2b_pass'
