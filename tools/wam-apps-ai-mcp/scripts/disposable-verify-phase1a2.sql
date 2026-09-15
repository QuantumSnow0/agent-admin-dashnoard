-- Disposable Phase 1A.2a verification (run after apply-disposable-fixture)
\set ON_ERROR_STOP on

\echo '=== privilege gate ==='
\i scripts/privilege-gate.sql

\echo '=== helper isolation (public/anon/authenticated/readonly) ==='
SELECT 'public_load_dispatch' AS check,
  has_function_privilege('public', 'wam_ai.load_dispatch_snapshot()', 'EXECUTE') AS can_exec;
SELECT 'anon_load_dispatch' AS check,
  has_function_privilege('anon', 'wam_ai.load_dispatch_snapshot()', 'EXECUTE') AS can_exec;
SELECT 'authenticated_load_dispatch' AS check,
  has_function_privilege('authenticated', 'wam_ai.load_dispatch_snapshot()', 'EXECUTE') AS can_exec;
SELECT 'readonly_load_dispatch' AS check,
  has_function_privilege('wam_ai_business_readonly', 'wam_ai.load_dispatch_snapshot()', 'EXECUTE') AS can_exec;
SELECT 'readonly_main_rpc' AS check,
  has_function_privilege('wam_ai_business_readonly', 'wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer)', 'EXECUTE') AS can_exec;

\echo '=== direct table SELECT must fail as readonly ==='
SET ROLE wam_ai_business_readonly;
DO $t$
BEGIN
  BEGIN
    PERFORM 1 FROM public.inbound_leads LIMIT 1;
    RAISE EXCEPTION 'verify_fail: readonly can SELECT inbound_leads';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'verify_pass: direct inbound_leads SELECT denied';
  END;
END;
$t$;

\echo '=== RPC smoke (available agents) ==='
SELECT (wam_ai.recommend_agents_for_lead(
  '77777777-7777-7777-7777-777777777777'::uuid, NULL, 5, false, false, 30
)->>'status') AS rpc_status,
  (wam_ai.recommend_agents_for_lead(
    '77777777-7777-7777-7777-777777777777'::uuid, NULL, 5, false, false, 30
  )->'recommended_agent'->>'agent_id') AS recommended_agent_id,
  (wam_ai.recommend_agents_for_lead(
    '77777777-7777-7777-7777-777777777777'::uuid, NULL, 5, false, false, 30
  )->'recommended_agent' ? 'phone') AS has_phone_field;

\echo '=== phone field scan in recommendation JSON ==='
SELECT CASE
  WHEN wam_ai.recommend_agents_for_lead(
    '77777777-7777-7777-7777-777777777777'::uuid, NULL, 5, false, false, 30
  )::text ~* '(phone|airtel_phone|safaricom_phone|primary_phone|alternate_phone)'
  THEN 'FAIL: phone-like key in output'
  ELSE 'PASS: no phone keys in output'
END AS phone_scan;

RESET ROLE;

\echo '=== unavailable agents cannot be default recommendation ==='
UPDATE public.agent_dispatch_settings SET is_available = false;
SET ROLE wam_ai_business_readonly;
DO $u$
DECLARE
  v_result jsonb;
BEGIN
  v_result := wam_ai.recommend_agents_for_lead(
    '77777777-7777-7777-7777-777777777777'::uuid, NULL, 5, false, false, 30
  );
  IF (v_result->'recommended_agent') IS NOT NULL
     AND v_result->>'recommended_agent' IS NOT NULL THEN
    RAISE EXCEPTION 'verify_fail: unavailable agents became default recommendation';
  END IF;
  IF coalesce(v_result->>'no_recommendation_reason', '') NOT IN (
    'no_available_agents_check_availability', 'no_hard_eligible_agents'
  ) THEN
    RAISE EXCEPTION 'verify_fail: unexpected no_recommendation_reason=%', v_result->>'no_recommendation_reason';
  END IF;
  RAISE NOTICE 'verify_pass: unavailable agents not default recommendation (%)', v_result->>'no_recommendation_reason';
END;
$u$;
RESET ROLE;

\echo '=== restore availability for fixture ==='
UPDATE public.agent_dispatch_settings SET is_available = true;

\echo 'disposable_verify_pass'
