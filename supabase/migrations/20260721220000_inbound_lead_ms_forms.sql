-- Store website MS Forms submission proof on inbound leads (DB only; no agent UI yet).

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS ms_forms_response_id TEXT,
  ADD COLUMN IF NOT EXISTS ms_forms_submitted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.inbound_leads.ms_forms_response_id IS
  'Microsoft Forms response id from website signup (Airtel). Null if Forms failed or skipped.';
COMMENT ON COLUMN public.inbound_leads.ms_forms_submitted_at IS
  'When the website successfully submitted this order to MS Forms.';

CREATE INDEX IF NOT EXISTS inbound_leads_ms_forms_response_id_idx
  ON public.inbound_leads (ms_forms_response_id)
  WHERE ms_forms_response_id IS NOT NULL;
