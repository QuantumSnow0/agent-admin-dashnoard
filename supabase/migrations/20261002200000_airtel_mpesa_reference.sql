ALTER TABLE public.customer_registrations
  ADD COLUMN IF NOT EXISTS mpesa_reference text;

COMMENT ON COLUMN public.customer_registrations.mpesa_reference IS
  'M-Pesa confirmation code entered when an Airtel registration is approved for payment.';

CREATE OR REPLACE FUNCTION public.guard_customer_registration_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  actor uuid;
  actor_is_agent boolean;
BEGIN
  actor := auth.uid();

  IF TG_OP = 'INSERT' THEN
    IF NEW.airtel_connect_order_id IS NOT NULL
      AND btrim(NEW.airtel_connect_order_id) <> '' THEN
      NEW.airtel_connect_order_id := btrim(NEW.airtel_connect_order_id);
      IF public.airtel_order_id_is_used(NEW.airtel_connect_order_id, NULL) THEN
        RAISE EXCEPTION 'This Order ID is already used';
      END IF;
      IF NEW.status IS NULL OR NEW.status = 'pending' THEN
        NEW.status := 'installed';
      END IF;
    END IF;
  END IF;

  actor_is_agent :=
    TG_OP = 'UPDATE'
    AND actor IS NOT NULL
    AND actor = NEW.agent_id
    AND NOT public.is_user_admin(actor);

  IF actor_is_agent THEN
    IF NEW.approved_amount_kes IS DISTINCT FROM OLD.approved_amount_kes
      OR NEW.denial_reason IS DISTINCT FROM OLD.denial_reason
      OR NEW.mpesa_reference IS DISTINCT FROM OLD.mpesa_reference
      OR NEW.status IN ('approved', 'denied')
      OR (
        NEW.status IS DISTINCT FROM OLD.status
        AND NEW.status IS DISTINCT FROM 'installed'
      ) THEN
      RAISE EXCEPTION 'Agents cannot change payment status';
    END IF;

    IF NEW.airtel_connect_order_id IS DISTINCT FROM OLD.airtel_connect_order_id
      OR NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Order ID can only be added while the registration is pending';
      END IF;
      IF OLD.airtel_connect_order_id IS NOT NULL
        AND btrim(OLD.airtel_connect_order_id) <> '' THEN
        RAISE EXCEPTION 'Order ID is already saved';
      END IF;
      IF NEW.airtel_connect_order_id IS NULL
        OR length(btrim(NEW.airtel_connect_order_id)) < 3 THEN
        RAISE EXCEPTION 'Enter a valid Airtel Connect Order ID';
      END IF;
      NEW.airtel_connect_order_id := btrim(NEW.airtel_connect_order_id);
      IF public.airtel_order_id_is_used(NEW.airtel_connect_order_id, NEW.id) THEN
        RAISE EXCEPTION 'This Order ID is already used';
      END IF;
      NEW.status := 'installed';
      NEW.approved_amount_kes := NULL;
      NEW.denial_reason := NULL;
      NEW.mpesa_reference := NULL;
    END IF;
  END IF;

  IF NEW.status = 'approved' THEN
    IF NEW.approved_amount_kes IS NULL OR NEW.approved_amount_kes < 1 THEN
      RAISE EXCEPTION 'Enter the payment amount';
    END IF;
    NEW.mpesa_reference := upper(regexp_replace(btrim(COALESCE(NEW.mpesa_reference, '')), '\s+', '', 'g'));
    IF NEW.mpesa_reference !~ '^[A-Z0-9]{6,20}$' THEN
      RAISE EXCEPTION 'Enter the M-Pesa reference code';
    END IF;
    NEW.denial_reason := NULL;
  ELSIF NEW.status = 'denied' THEN
    IF NEW.denial_reason IS NULL OR length(btrim(NEW.denial_reason)) < 3 THEN
      RAISE EXCEPTION 'Enter a reason for denial';
    END IF;
    NEW.denial_reason := btrim(NEW.denial_reason);
    NEW.approved_amount_kes := NULL;
    NEW.mpesa_reference := NULL;
  ELSE
    NEW.approved_amount_kes := NULL;
    NEW.mpesa_reference := NULL;
    IF NEW.status IS DISTINCT FROM 'denied' THEN
      NEW.denial_reason := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_registration_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  notification_title TEXT;
  notification_message TEXT;
  customer_name TEXT;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;

  customer_name := NEW.customer_name;

  IF NEW.status = 'installed' THEN
    notification_title := 'Order ID logged';
    notification_message := format(
      'Customer ''%s'' is installed on your side and waiting for confirmation.',
      customer_name
    );

    INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata)
    VALUES (
      NEW.agent_id,
      'REGISTRATION_STATUS_CHANGE',
      notification_title,
      notification_message,
      NEW.id,
      jsonb_build_object('status', NEW.status, 'customerName', customer_name)
    );

  ELSIF NEW.status = 'approved' THEN
    notification_title := 'Payment approved';
    notification_message := format(
      'Payment for ''%s'' is approved. You earned KSh %s. M-Pesa %s.',
      customer_name,
      COALESCE(NEW.approved_amount_kes, 0),
      COALESCE(NEW.mpesa_reference, '')
    );

    INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata)
    VALUES (
      NEW.agent_id,
      'REGISTRATION_STATUS_CHANGE',
      notification_title,
      notification_message,
      NEW.id,
      jsonb_build_object(
        'status', NEW.status,
        'customerName', customer_name,
        'amount', NEW.approved_amount_kes,
        'mpesaReference', NEW.mpesa_reference
      )
    );

  ELSIF NEW.status = 'denied' THEN
    notification_title := 'Payment denied';
    notification_message := format(
      'Payment for ''%s'' was denied. %s',
      customer_name,
      COALESCE(NEW.denial_reason, '')
    );

    INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata)
    VALUES (
      NEW.agent_id,
      'REGISTRATION_STATUS_CHANGE',
      notification_title,
      notification_message,
      NEW.id,
      jsonb_build_object(
        'status', NEW.status,
        'customerName', customer_name,
        'reason', NEW.denial_reason
      )
    );

  ELSIF NEW.status = 'rejected' THEN
    notification_title := 'Registration Rejected';
    notification_message := format(
      'Customer ''%s'' registration was rejected and will not be installed.',
      customer_name
    );

    INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata)
    VALUES (
      NEW.agent_id,
      'REGISTRATION_STATUS_CHANGE',
      notification_title,
      notification_message,
      NEW.id,
      jsonb_build_object('status', NEW.status, 'customerName', customer_name)
    );

  ELSIF NEW.status = 'duplicate' THEN
    notification_title := 'Duplicate Registration';
    notification_message := format(
      'Customer ''%s'' was marked as a duplicate — no installation or commission.',
      customer_name
    );

    INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata)
    VALUES (
      NEW.agent_id,
      'REGISTRATION_STATUS_CHANGE',
      notification_title,
      notification_message,
      NEW.id,
      jsonb_build_object('status', NEW.status, 'customerName', customer_name)
    );

  ELSIF NEW.status = 'cancelled' THEN
    notification_title := 'Registration Cancelled';
    notification_message := format(
      'Customer ''%s'' registration was cancelled before installation.',
      customer_name
    );

    INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata)
    VALUES (
      NEW.agent_id,
      'REGISTRATION_STATUS_CHANGE',
      notification_title,
      notification_message,
      NEW.id,
      jsonb_build_object('status', NEW.status, 'customerName', customer_name)
    );
  END IF;

  RETURN NEW;
END;
$$;
