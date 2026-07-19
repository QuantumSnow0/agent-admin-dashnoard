-- Install review outcomes (mirror customer_registrations: rejected / duplicate / cancelled).

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
    'rejected',
    'duplicate',
    'cancelled',
    'needs_reassignment',
    'admin_queue',
    'lost',
    'expired'
  ));
