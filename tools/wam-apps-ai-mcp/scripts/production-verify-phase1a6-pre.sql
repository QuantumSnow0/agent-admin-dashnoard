-- Phase 1A.6 PRE-MIGRATION checks (read-only)
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regprocedure(
    'wam_ai.prepare_send_agent_sms(uuid,text,text,text,uuid,uuid,text,text,text,text,text,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: prepare_send_agent_sms already present (duplicate apply?)';
  END IF;
  IF to_regclass('wam_ai.sms_send_intents') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: sms_send_intents already present';
  END IF;
  RAISE NOTICE 'PASS: Phase 1A.6 pre-migration — SMS objects absent';
END $$;
