-- Reset mutable fixture rows to canonical seed state (idempotent)
\set ON_ERROR_STOP on

\echo '=== disposable fixture reset ==='

UPDATE public.agents SET
  status = 'approved',
  lead_dispatch_scope = 'both',
  is_fallback_agent = false,
  fallback_priority = 100
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE public.agents SET
  status = 'approved',
  lead_dispatch_scope = 'both',
  is_fallback_agent = false
WHERE id = '22222222-2222-2222-2222-222222222222';

UPDATE public.agents SET
  status = 'approved',
  lead_dispatch_scope = 'both'
WHERE id = '44444444-4444-4444-4444-444444444444';

UPDATE public.agents SET status = 'pending', lead_dispatch_scope = 'both'
WHERE id = '55555555-5555-5555-5555-555555555555';

UPDATE public.agents SET status = 'banned', lead_dispatch_scope = 'none'
WHERE id = '99999999-9999-9999-9999-999999999999';

UPDATE public.agent_dispatch_settings SET service_radius_km = NULL
WHERE agent_id = '22222222-2222-2222-2222-222222222222';

UPDATE public.inbound_leads SET
  status = 'offered',
  commission_earned_ksh = NULL,
  installed_at = NULL,
  preferred_agent_id = NULL
WHERE id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

UPDATE public.lead_offers SET
  status = 'offered',
  expires_at = now() + interval '1 day',
  responded_at = NULL
WHERE id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';

UPDATE public.inbound_leads SET
  status = 'assigned',
  commission_earned_ksh = NULL,
  installed_at = NULL
WHERE id = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';

UPDATE public.inbound_leads SET
  status = 'pending_install',
  commission_earned_ksh = NULL,
  installed_at = NULL
WHERE id = '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

UPDATE public.inbound_leads SET
  status = 'rejected',
  commission_earned_ksh = NULL,
  installed_at = NULL
WHERE id = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';

UPDATE public.inbound_leads SET
  status = 'installed',
  commission_earned_ksh = 200,
  installed_at = now()
WHERE id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';

UPDATE public.customer_registrations SET status = 'pending'
WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

\echo 'disposable_fixture_reset_pass'
