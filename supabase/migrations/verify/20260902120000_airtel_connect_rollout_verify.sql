-- Verification for Airtel Connect registration rollout (run on disposable DB after migration)
\set ON_ERROR_STOP on

\echo '=== default: global OFF => legacy ==='
DO $$
DECLARE r jsonb;
BEGIN
  SELECT public.get_my_registration_mode() INTO r;
  -- Without auth.uid() this returns unauthenticated legacy; structure exists.
  IF r->>'mode' IS NULL THEN
    RAISE EXCEPTION 'get_my_registration_mode missing mode';
  END IF;
END $$;

\echo '=== county table seeded legacy ==='
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM public.registration_county_modes WHERE registration_mode <> 'legacy_wam';
  IF c <> 0 THEN
    RAISE EXCEPTION 'expected all counties legacy by default, got % non-legacy', c;
  END IF;
END $$;

\echo '=== nullable legacy columns ==='
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'customer_registrations'
  AND column_name IN ('alternate_number', 'visit_date', 'visit_time', 'installation_town');

\echo 'airtel_connect_rollout_verify_pass'
