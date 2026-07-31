-- Deferred callback reminders: park lead until callback_at, then wake for preferred agent first.

ALTER TABLE public.inbound_leads
  DROP CONSTRAINT IF EXISTS inbound_leads_status_check;

ALTER TABLE public.inbound_leads
  ADD CONSTRAINT inbound_leads_status_check CHECK (
    status IN (
      'pending_dispatch',
      'offered',
      'assigned',
      'kyc_in_progress',
      'kyc_completed',
      'pending_install',
      'installed',
      'rejected',
      'duplicate',
      'cancelled',
      'needs_reassignment',
      'admin_queue',
      'lost',
      'expired',
      'deferred'
    )
  );

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS callback_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preferred_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_leads_deferred_callback
  ON public.inbound_leads (callback_at)
  WHERE status = 'deferred';

CREATE INDEX IF NOT EXISTS idx_inbound_leads_preferred_agent
  ON public.inbound_leads (preferred_agent_id)
  WHERE preferred_agent_id IS NOT NULL;

-- Agents can see parked reminders they own (not yet re-offered).
DROP POLICY IF EXISTS "Agents read preferred deferred leads" ON public.inbound_leads;
CREATE POLICY "Agents read preferred deferred leads"
  ON public.inbound_leads FOR SELECT
  USING (
    auth.uid() = preferred_agent_id
    AND status = 'deferred'
  );

COMMENT ON COLUMN public.inbound_leads.callback_at IS
  'When status=deferred: wake and re-dispatch on/after this time (preferred agent first).';
COMMENT ON COLUMN public.inbound_leads.preferred_agent_id IS
  'Agent who deferred / gets first offer on callback wake before county/fallback/admin.';
