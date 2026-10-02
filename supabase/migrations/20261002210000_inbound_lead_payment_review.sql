ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS mpesa_reference text,
  ADD COLUMN IF NOT EXISTS denial_reason text;

COMMENT ON COLUMN public.inbound_leads.mpesa_reference IS
  'M-Pesa confirmation code entered when an inbound lead payment is approved.';
COMMENT ON COLUMN public.inbound_leads.denial_reason IS
  'Reason shown to the agent when an inbound lead payment is denied.';

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
      'approved',
      'denied',
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
