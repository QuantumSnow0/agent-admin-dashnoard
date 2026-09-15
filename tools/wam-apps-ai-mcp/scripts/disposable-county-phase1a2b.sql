-- Disposable Phase 1A.2b concurrency + county integrity verification
\set ON_ERROR_STOP on

\echo '=== prepare concurrency lead ==='
UPDATE public.inbound_leads
SET status = 'admin_queue', assigned_agent_id = NULL, accepted_at = NULL, county = NULL
WHERE id = '77777777-7777-7777-7777-777777777777';
DELETE FROM public.lead_offers WHERE lead_id = '77777777-7777-7777-7777-777777777777';
DELETE FROM public.notifications WHERE related_id = '77777777-7777-7777-7777-777777777777';
DELETE FROM wam_ai.action_requests WHERE lead_ref = wam_ai.lead_ref('77777777-7777-7777-7777-777777777777'::uuid);
-- action_events are immutable; leave prior audit rows in disposable fixture

\echo '=== county integrity: missing customer county stays missing ==='
UPDATE public.inbound_leads
SET status = 'admin_queue', county = NULL, metadata = '{}'::jsonb,
    installation_town = NULL, assigned_agent_id = NULL, accepted_at = NULL
WHERE id = '77777777-7777-7777-7777-777777777777';
DELETE FROM public.lead_offers WHERE lead_id = '77777777-7777-7777-7777-777777777777';
DELETE FROM wam_ai.action_requests WHERE idempotency_key = 'cccccccc-cccc-cccc-cccc-cccccccccc01'::uuid;

SELECT (wam_ai.create_lead_offer(
  '77777777-7777-7777-7777-777777777777'::uuid, NULL,
  '33333333-3333-3333-3333-333333333333'::uuid, NULL,
  'cccccccc-cccc-cccc-cccc-cccccccccc01'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddd01'::uuid,
  'county_test', 'technical_owner', 'County integrity missing',
  NULL, 'admin_queue', true, NULL, NULL
)->>'status') AS county_missing_status;

SELECT county IS NULL AS county_still_missing
FROM public.inbound_leads WHERE id = '77777777-7777-7777-7777-777777777777';

\echo '=== county integrity: existing lead county preserved ==='
UPDATE public.inbound_leads
SET status = 'admin_queue', county = 'Nairobi', metadata = '{}'::jsonb,
    installation_town = 'Nairobi', assigned_agent_id = NULL, accepted_at = NULL
WHERE id = '77777777-7777-7777-7777-777777777777';
DELETE FROM public.lead_offers WHERE lead_id = '77777777-7777-7777-7777-777777777777';
DELETE FROM wam_ai.action_requests WHERE idempotency_key = 'cccccccc-cccc-cccc-cccc-cccccccccc02'::uuid;

SELECT (wam_ai.create_lead_offer(
  '77777777-7777-7777-7777-777777777777'::uuid, NULL,
  '11111111-1111-1111-1111-111111111111'::uuid, NULL,
  'cccccccc-cccc-cccc-cccc-cccccccccc02'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddd02'::uuid,
  'county_test', 'technical_owner', 'County integrity preserve',
  NULL, 'admin_queue', true, NULL, NULL
)->>'status') AS preserve_status;

SELECT county = 'Nairobi' AS county_preserved
FROM public.inbound_leads WHERE id = '77777777-7777-7777-7777-777777777777';

\echo '=== county integrity: verified googlePlace county applied ==='
UPDATE public.inbound_leads
SET status = 'admin_queue', county = 'Nairobi', metadata = '{"googlePlace":{"county":"Kiambu","lat":-1.1,"lng":36.9}}'::jsonb,
    assigned_agent_id = NULL, accepted_at = NULL
WHERE id = '77777777-7777-7777-7777-777777777777';
DELETE FROM public.lead_offers WHERE lead_id = '77777777-7777-7777-7777-777777777777';
DELETE FROM wam_ai.action_requests WHERE idempotency_key = 'cccccccc-cccc-cccc-cccc-cccccccccc03'::uuid;

SELECT (wam_ai.create_lead_offer(
  '77777777-7777-7777-7777-777777777777'::uuid, NULL,
  '11111111-1111-1111-1111-111111111111'::uuid, NULL,
  'cccccccc-cccc-cccc-cccc-cccccccccc03'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddd03'::uuid,
  'county_test', 'technical_owner', 'County integrity googlePlace',
  NULL, 'admin_queue', true, NULL, NULL
)->>'status') AS google_status;

SELECT county = 'Kiambu' AS verified_customer_county_applied
FROM public.inbound_leads WHERE id = '77777777-7777-7777-7777-777777777777';

\echo '=== idempotency actor ownership ==='
SELECT (wam_ai.create_lead_offer(
  '77777777-7777-7777-7777-777777777777'::uuid, NULL,
  '11111111-1111-1111-1111-111111111111'::uuid, NULL,
  'cccccccc-cccc-cccc-cccc-cccccccccc03'::uuid,
  'dddddddd-dddd-dddd-dddd-dddddddddd04'::uuid,
  'other_actor', 'technical_owner', 'Actor conflict test',
  NULL, NULL, NULL, NULL, NULL
)->>'error_category') AS actor_idempotency_conflict;

\echo '=== reset for concurrency ==='
UPDATE public.inbound_leads
SET status = 'admin_queue', county = 'Nairobi', metadata = '{"googlePlace":{"county":"Nairobi","lat":-1.2921,"lng":36.8219}}'::jsonb,
    assigned_agent_id = NULL, accepted_at = NULL
WHERE id = '77777777-7777-7777-7777-777777777777';
DELETE FROM public.lead_offers WHERE lead_id = '77777777-7777-7777-7777-777777777777';
DELETE FROM public.notifications WHERE related_id = '77777777-7777-7777-7777-777777777777';
DELETE FROM wam_ai.action_requests WHERE lead_ref = wam_ai.lead_ref('77777777-7777-7777-7777-777777777777'::uuid);
-- action_events are immutable; leave prior audit rows in disposable fixture

\echo 'concurrency_and_county_checks_prepared'
