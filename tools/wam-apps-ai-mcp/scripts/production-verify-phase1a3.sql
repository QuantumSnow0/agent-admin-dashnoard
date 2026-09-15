-- DEPRECATED entrypoint: Phase 1A.3 verification is split into pre/post scripts.
-- Choosing the wrong state previously allowed missing RPCs to disappear from results.
\echo 'ERROR: Use production-verify-phase1a3-pre.sql BEFORE migrations'
\echo 'ERROR: Use production-verify-phase1a3-post.sql AFTER migrations and grants'
DO $$
BEGIN
  RAISE EXCEPTION
    'production_verify_phase1a3: refuse ambiguous combined script — run production-verify-phase1a3-pre.sql or production-verify-phase1a3-post.sql';
END $$;
