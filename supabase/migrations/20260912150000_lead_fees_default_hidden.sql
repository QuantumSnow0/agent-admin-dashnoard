UPDATE public.dispatch_config
SET
  lead_submitter_commission_kes = 0,
  lead_receiver_commission_kes = 0;

ALTER TABLE public.dispatch_config
  ALTER COLUMN lead_submitter_commission_kes SET DEFAULT 0,
  ALTER COLUMN lead_receiver_commission_kes SET DEFAULT 0;
