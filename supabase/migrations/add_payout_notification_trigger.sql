-- Notify agents when admin records a payout in agent_payments

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'REGISTRATION_STATUS_CHANGE',
    'EARNINGS_UPDATE',
    'ACCOUNT_STATUS_CHANGE',
    'SYNC_FAILURE',
    'SYSTEM_ANNOUNCEMENT',
    'PAYOUT_RECEIVED'
  ));

CREATE OR REPLACE FUNCTION public.create_payout_notification()
RETURNS TRIGGER AS $$
DECLARE
  notification_message TEXT;
BEGIN
  notification_message := format(
    'KSh %s has been sent to you.',
    TRIM(TO_CHAR(NEW.amount_ksh, 'FM999,999,999,990'))
  );

  IF NEW.reference IS NOT NULL AND btrim(NEW.reference) <> '' THEN
    notification_message := notification_message || format(' Reference: %s.', btrim(NEW.reference));
  END IF;

  INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata)
  VALUES (
    NEW.agent_id,
    'PAYOUT_RECEIVED',
    'Payment Received',
    notification_message,
    NEW.id,
    jsonb_build_object(
      'amount', NEW.amount_ksh,
      'reference', NEW.reference,
      'notes', NEW.notes
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_agent_payment_notification ON public.agent_payments;

CREATE TRIGGER trigger_agent_payment_notification
  AFTER INSERT ON public.agent_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_payout_notification();

COMMENT ON FUNCTION public.create_payout_notification() IS
  'Creates PAYOUT_RECEIVED notification when admin records a payout in agent_payments';

-- Agents can read their own payout history (used by app wallet / profile)
DROP POLICY IF EXISTS "Agents can view own agent payments" ON public.agent_payments;

CREATE POLICY "Agents can view own agent payments"
  ON public.agent_payments
  FOR SELECT
  USING (auth.uid() = agent_id);
