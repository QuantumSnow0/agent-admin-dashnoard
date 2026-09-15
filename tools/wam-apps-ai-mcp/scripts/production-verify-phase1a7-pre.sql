-- Phase 1A.7 PRE-MIGRATION checks (fail closed)
-- Does not mutate schema. Fails if required canonical columns are absent.
\set ON_ERROR_STOP on
DO $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regprocedure('wam_ai.reconcile_customer_batch(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: reconcile_customer_batch already present — refuse re-apply without remediation path';
  END IF;

  IF to_regclass('public.agents') IS NULL THEN
    v_missing := array_append(v_missing, 'public.agents');
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'created_at'
  ) THEN
    v_missing := array_append(v_missing, 'public.agents.created_at');
  END IF;

  IF to_regclass('public.inbound_leads') IS NULL THEN
    v_missing := array_append(v_missing, 'public.inbound_leads');
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inbound_leads' AND column_name = 'primary_phone'
    ) THEN
      v_missing := array_append(v_missing, 'public.inbound_leads.primary_phone');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inbound_leads' AND column_name = 'alternate_phone'
    ) THEN
      v_missing := array_append(v_missing, 'public.inbound_leads.alternate_phone');
    END IF;
  END IF;

  IF to_regclass('public.customer_registrations') IS NULL THEN
    v_missing := array_append(v_missing, 'public.customer_registrations');
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_registrations' AND column_name = 'airtel_number'
    ) THEN
      v_missing := array_append(v_missing, 'public.customer_registrations.airtel_number');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_registrations' AND column_name = 'alternate_number'
    ) THEN
      v_missing := array_append(v_missing, 'public.customer_registrations.alternate_number');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_registrations' AND column_name = 'inbound_lead_id'
    ) THEN
      v_missing := array_append(v_missing, 'public.customer_registrations.inbound_lead_id');
    END IF;
  END IF;

  IF to_regclass('public.safaricom_registrations') IS NULL THEN
    v_missing := array_append(v_missing, 'public.safaricom_registrations');
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'safaricom_registrations' AND column_name = 'safaricom_number'
    ) THEN
      v_missing := array_append(v_missing, 'public.safaricom_registrations.safaricom_number');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'safaricom_registrations' AND column_name = 'alternate_number'
    ) THEN
      v_missing := array_append(v_missing, 'public.safaricom_registrations.alternate_number');
    END IF;
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION
      'FAIL: Phase 1A.7 pre-verifier — required canonical columns absent: %. Phase 1A.7 must not ALTER public tables; restore schema outside this migration.',
      array_to_string(v_missing, ', ');
  END IF;

  RAISE NOTICE 'PASS: Phase 1A.7 pre-migration — intelligence RPCs absent; required canonical columns present';
END $$;
