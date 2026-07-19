-- Agent submits install proof → pending_install.
-- Admin confirms → installed (+ commission). Payments stay on admin payouts only.

ALTER TABLE public.inbound_leads
  DROP CONSTRAINT IF EXISTS inbound_leads_status_check;

ALTER TABLE public.inbound_leads
  ADD CONSTRAINT inbound_leads_status_check CHECK (status IN (
    'pending_dispatch',
    'offered',
    'assigned',
    'kyc_in_progress',
    'kyc_completed',
    'pending_install',
    'installed',
    'needs_reassignment',
    'admin_queue',
    'lost',
    'expired'
  ));

COMMENT ON COLUMN public.inbound_leads.status IS
  'Lifecycle. pending_install = agent submitted SR/IMEI; installed = admin confirmed (commission accrues).';
