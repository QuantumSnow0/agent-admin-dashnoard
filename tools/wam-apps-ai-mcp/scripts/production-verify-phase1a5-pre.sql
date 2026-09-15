-- Phase 1A.5 PRE-MIGRATION checks (production-safe read-only)
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regprocedure('wam_ai.mark_lead_kyc_completed(uuid,text,uuid,uuid,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: Phase 1A.5 mark_lead_kyc_completed already present';
  END IF;
  IF to_regprocedure('wam_ai.expire_lead_offer(uuid,text,uuid,uuid,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: Phase 1A.5 expire_lead_offer already present';
  END IF;
  IF to_regprocedure('wam_ai.set_agent_pending(uuid,text,uuid,uuid,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: Phase 1A.5 set_agent_pending already present';
  END IF;
  RAISE NOTICE 'PASS: Phase 1A.5 pre-migration verification (RPCs absent)';
END $$;
