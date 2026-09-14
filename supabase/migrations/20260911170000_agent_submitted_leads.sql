-- Agent-submitted inbound leads (lead-gen) + configurable commission knobs (testing).
-- Commissions are stored for admin tuning; payouts are NOT wired yet.

ALTER TABLE public.dispatch_config
  ADD COLUMN IF NOT EXISTS lead_submitter_commission_kes INT NOT NULL DEFAULT 50
    CHECK (lead_submitter_commission_kes >= 0 AND lead_submitter_commission_kes <= 100000),
  ADD COLUMN IF NOT EXISTS lead_receiver_commission_kes INT NOT NULL DEFAULT 200
    CHECK (lead_receiver_commission_kes >= 0 AND lead_receiver_commission_kes <= 100000);

COMMENT ON COLUMN public.dispatch_config.lead_submitter_commission_kes IS
  'Testing/config: KSh for agent who submitted the lead (finder). Not applied to wallet yet.';
COMMENT ON COLUMN public.dispatch_config.lead_receiver_commission_kes IS
  'Testing/config: KSh for agent who accepts/installs the lead. Not applied to wallet yet.';

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS submitted_by_agent_id UUID
    REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_leads_submitted_by
  ON public.inbound_leads (submitted_by_agent_id)
  WHERE submitted_by_agent_id IS NOT NULL;

COMMENT ON COLUMN public.inbound_leads.submitted_by_agent_id IS
  'Agent who submitted this lead (agent_own). Separate from assigned_agent_id (installer).';

-- Submitters can see status of leads they created (PII they already know).
DROP POLICY IF EXISTS "Agents read own submitted inbound leads" ON public.inbound_leads;
CREATE POLICY "Agents read own submitted inbound leads"
  ON public.inbound_leads FOR SELECT
  TO authenticated
  USING (submitted_by_agent_id = auth.uid());
