-- Phase 1A.8 PRE checks
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF to_regprocedure('wam_ai.begin_reconcile_session(text,text,text,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: begin_reconcile_session already present';
  END IF;
  RAISE NOTICE 'PASS: Phase 1A.8 pre — session RPCs absent';
END $$;
