-- Allow submitter status alerts when an installer accepts their lead.
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
    'LEAD_INSTALLED',
    'LEAD_SUBMITTED_STATUS'
  ));
