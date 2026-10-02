-- Approved and denied were written into the notification function, but the
-- trigger filter still only fired for the older statuses.

DROP TRIGGER IF EXISTS trigger_registration_status_notification ON public.customer_registrations;
DROP TRIGGER IF EXISTS trigger_registration_status_notification_insert ON public.customer_registrations;

CREATE TRIGGER trigger_registration_status_notification
  AFTER UPDATE OF status ON public.customer_registrations
  FOR EACH ROW
  WHEN (NEW.status IN ('installed', 'approved', 'denied', 'rejected', 'duplicate', 'cancelled'))
  EXECUTE FUNCTION public.create_registration_status_notification();

CREATE TRIGGER trigger_registration_status_notification_insert
  AFTER INSERT ON public.customer_registrations
  FOR EACH ROW
  WHEN (NEW.status IN ('installed', 'approved', 'denied', 'rejected', 'duplicate', 'cancelled'))
  EXECUTE FUNCTION public.create_registration_status_notification();

-- Catch denials that landed before the trigger included this status.
INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata)
SELECT
  cr.agent_id,
  'REGISTRATION_STATUS_CHANGE',
  'Payment denied',
  format('Payment for ''%s'' was denied. %s', cr.customer_name, COALESCE(cr.denial_reason, '')),
  cr.id,
  jsonb_build_object(
    'status', 'denied',
    'customerName', cr.customer_name,
    'reason', cr.denial_reason
  )
FROM public.customer_registrations cr
WHERE cr.status = 'denied'
  AND cr.agent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.related_id = cr.id
      AND n.metadata->>'status' = 'denied'
  );
