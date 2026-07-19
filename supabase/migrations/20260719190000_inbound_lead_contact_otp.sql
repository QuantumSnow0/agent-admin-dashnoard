-- Verified customer contact for inbound Airtel leads.
-- OTP values are never stored in plaintext and are only accessible to service-role functions.

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS contact_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_verified_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_verification_method TEXT,
  ADD COLUMN IF NOT EXISTS call_initiated_at TIMESTAMPTZ;

ALTER TABLE public.inbound_leads
  DROP CONSTRAINT IF EXISTS inbound_leads_contact_verification_method_check;

ALTER TABLE public.inbound_leads
  ADD CONSTRAINT inbound_leads_contact_verification_method_check
  CHECK (
    contact_verification_method IS NULL
    OR contact_verification_method IN ('sms_otp')
  );

COMMENT ON COLUMN public.inbound_leads.contact_verified_at IS
  'Time the assigned agent verified access to the customer phone using an OTP.';
COMMENT ON COLUMN public.inbound_leads.call_initiated_at IS
  'Time the assigned agent used the in-app call action. This records intent, not call duration.';

-- A lead-sourced registration uses the normal MS Forms pipeline but must not earn
-- the normal Airtel registration commission in addition to the lead install commission.
ALTER TABLE public.customer_registrations
  ADD COLUMN IF NOT EXISTS inbound_lead_id UUID,
  ADD COLUMN IF NOT EXISTS commission_exempt BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_registrations_inbound_lead
  ON public.customer_registrations (inbound_lead_id)
  WHERE inbound_lead_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_registrations_inbound_lead_id_fkey'
  ) THEN
    ALTER TABLE public.customer_registrations
      ADD CONSTRAINT customer_registrations_inbound_lead_id_fkey
      FOREIGN KEY (inbound_lead_id)
      REFERENCES public.inbound_leads(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inbound_leads_registration_id_fkey'
  ) THEN
    ALTER TABLE public.inbound_leads
      ADD CONSTRAINT inbound_leads_registration_id_fkey
      FOREIGN KEY (registration_id)
      REFERENCES public.customer_registrations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.customer_registrations.inbound_lead_id IS
  'Inbound lead that produced this MS Forms registration, if any.';
COMMENT ON COLUMN public.customer_registrations.commission_exempt IS
  'True for lead-sourced registrations paid through the separate lead install commission.';

CREATE TABLE IF NOT EXISTS public.lead_contact_otp_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.inbound_leads(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  provider_message_id TEXT,
  provider_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (provider_status IN ('pending', 'accepted', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_lead_contact_otp_recent
  ON public.lead_contact_otp_attempts (lead_id, agent_id, created_at DESC);

ALTER TABLE public.lead_contact_otp_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lead_contact_otp_attempts FROM anon, authenticated;

COMMENT ON TABLE public.lead_contact_otp_attempts IS
  'Service-role-only audit and rate-limit records for customer contact OTPs.';

-- Keep normal Airtel earnings free of lead-sourced registrations.
CREATE OR REPLACE FUNCTION public.recalculate_agent_airtel_earnings(p_agent_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  cfg RECORD;
  reg RECORD;
  total INTEGER := 0;
  units INTEGER;
  pkg TEXT;
  paid_sum INTEGER := 0;
BEGIN
  SELECT standard_commission, premium_commission INTO cfg
  FROM public.commission_rates_config
  LIMIT 1;

  IF cfg IS NULL THEN
    cfg.standard_commission := 500;
    cfg.premium_commission := 700;
  END IF;

  FOR reg IN
    SELECT
      preferred_package,
      units_required,
      commission_package,
      commission_units
    FROM public.customer_registrations
    WHERE agent_id = p_agent_id
      AND status = 'installed'
      AND NOT COALESCE(commission_exempt, FALSE)
  LOOP
    pkg := COALESCE(reg.commission_package, reg.preferred_package, 'standard');
    units := GREATEST(1, COALESCE(reg.commission_units, reg.units_required, 1));

    IF pkg = 'premium' THEN
      total := total + (cfg.premium_commission * units);
    ELSE
      total := total + (cfg.standard_commission * units);
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(amount_ksh), 0)::INTEGER INTO paid_sum
  FROM public.agent_payments
  WHERE agent_id = p_agent_id;

  UPDATE public.agents
  SET
    total_earnings = total,
    available_balance = GREATEST(0, total - paid_sum),
    updated_at = NOW()
  WHERE id = p_agent_id;

  RETURN total;
END;
$$;
