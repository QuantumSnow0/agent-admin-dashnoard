-- Package-specific non-installer lead fees (standard vs premium).
-- Legacy flat columns stay in sync as MAX(standard, premium) for older clients.

ALTER TABLE public.dispatch_config
  ADD COLUMN IF NOT EXISTS lead_submitter_commission_standard_kes INT NOT NULL DEFAULT 0
    CHECK (lead_submitter_commission_standard_kes >= 0 AND lead_submitter_commission_standard_kes <= 100000),
  ADD COLUMN IF NOT EXISTS lead_submitter_commission_premium_kes INT NOT NULL DEFAULT 0
    CHECK (lead_submitter_commission_premium_kes >= 0 AND lead_submitter_commission_premium_kes <= 100000),
  ADD COLUMN IF NOT EXISTS lead_receiver_commission_standard_kes INT NOT NULL DEFAULT 0
    CHECK (lead_receiver_commission_standard_kes >= 0 AND lead_receiver_commission_standard_kes <= 100000),
  ADD COLUMN IF NOT EXISTS lead_receiver_commission_premium_kes INT NOT NULL DEFAULT 0
    CHECK (lead_receiver_commission_premium_kes >= 0 AND lead_receiver_commission_premium_kes <= 100000);

COMMENT ON COLUMN public.dispatch_config.lead_submitter_commission_standard_kes IS
  'KSh for finder on standard package agent_own leads. 0 = hidden in app.';
COMMENT ON COLUMN public.dispatch_config.lead_submitter_commission_premium_kes IS
  'KSh for finder on premium package agent_own leads. 0 = hidden in app.';
COMMENT ON COLUMN public.dispatch_config.lead_receiver_commission_standard_kes IS
  'KSh for installer on standard package agent_own leads. 0 = hidden in app.';
COMMENT ON COLUMN public.dispatch_config.lead_receiver_commission_premium_kes IS
  'KSh for installer on premium package agent_own leads. 0 = hidden in app.';

-- Backfill from previous flat rates (same amount on both packages).
UPDATE public.dispatch_config
SET
  lead_submitter_commission_standard_kes = COALESCE(lead_submitter_commission_kes, 0),
  lead_submitter_commission_premium_kes = COALESCE(lead_submitter_commission_kes, 0),
  lead_receiver_commission_standard_kes = COALESCE(lead_receiver_commission_kes, 0),
  lead_receiver_commission_premium_kes = COALESCE(lead_receiver_commission_kes, 0)
WHERE TRUE;
