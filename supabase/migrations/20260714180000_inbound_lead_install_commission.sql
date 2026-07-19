-- Flat commission on inbound lead install (agent proof: SR / IMEI).
-- v1 amount: KSh 200 (see LEAD_INSTALL_COMMISSION_KES in app / dashboard constants).

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS commission_earned_ksh NUMERIC(12, 2);

COMMENT ON COLUMN public.inbound_leads.commission_earned_ksh IS
  'Commission credited when status becomes installed (v1 flat KSh 200).';

-- Allow install-commission in-app notifications
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_type_check'
  ) THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'REGISTRATION_STATUS_CHANGE',
    'EARNINGS_UPDATE',
    'ACCOUNT_STATUS_CHANGE',
    'SYNC_FAILURE',
    'SYSTEM_ANNOUNCEMENT',
    'PAYOUT_RECEIVED',
    'LEAD_OFFER',
    'LEAD_OVERDUE',
    'LEAD_INSTALLED'
  ));
