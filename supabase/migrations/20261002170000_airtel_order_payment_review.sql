-- Airtel registrations: Order ID means installed. Payment is a separate approval
-- with a custom amount, or a denial with a reason. A used Order ID cannot be saved.

ALTER TABLE public.customer_registrations
  ADD COLUMN IF NOT EXISTS approved_amount_kes integer,
  ADD COLUMN IF NOT EXISTS denial_reason text;

COMMENT ON COLUMN public.customer_registrations.approved_amount_kes IS
  'Custom KSh amount counted for payment after admin approval. Not the old 500/700 rates.';
COMMENT ON COLUMN public.customer_registrations.denial_reason IS
  'Reason shown to the agent when payment is denied.';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'customer_registrations'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ~* '(^|[^a-z_])status in'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.customer_registrations DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.customer_registrations
  DROP CONSTRAINT IF EXISTS customer_registrations_status_check;

ALTER TABLE public.customer_registrations
  ADD CONSTRAINT customer_registrations_status_check
  CHECK (
    status IN (
      'pending',
      'installed',
      'approved',
      'denied',
      'rejected',
      'duplicate',
      'cancelled'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS customer_registrations_order_id_unique
  ON public.customer_registrations (lower(btrim(airtel_connect_order_id)))
  WHERE airtel_connect_order_id IS NOT NULL
    AND btrim(airtel_connect_order_id) <> '';

CREATE OR REPLACE FUNCTION public.airtel_order_id_is_used(
  p_order_id text,
  p_exclude_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_registrations
    WHERE airtel_connect_order_id IS NOT NULL
      AND btrim(airtel_connect_order_id) <> ''
      AND lower(btrim(airtel_connect_order_id)) = lower(btrim(COALESCE(p_order_id, '')))
      AND (p_exclude_id IS NULL OR id <> p_exclude_id)
  );
$$;

REVOKE ALL ON FUNCTION public.airtel_order_id_is_used(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.airtel_order_id_is_used(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.airtel_order_id_is_used(text, uuid) TO service_role;

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
    END IF;
  END IF;

  IF NEW.status = 'approved' THEN
    IF NEW.approved_amount_kes IS NULL OR NEW.approved_amount_kes < 1 THEN
      RAISE EXCEPTION 'Enter the payment amount';
    END IF;
    NEW.denial_reason := NULL;
  ELSIF NEW.status = 'denied' THEN
    IF NEW.denial_reason IS NULL OR length(btrim(NEW.denial_reason)) < 3 THEN
      RAISE EXCEPTION 'Enter a reason for denial';
    END IF;
    NEW.denial_reason := btrim(NEW.denial_reason);
    NEW.approved_amount_kes := NULL;
  ELSE
    NEW.approved_amount_kes := NULL;
    IF NEW.status IS DISTINCT FROM 'denied' THEN
      NEW.denial_reason := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_customer_registration_payment ON public.customer_registrations;
CREATE TRIGGER guard_customer_registration_payment
  BEFORE INSERT OR UPDATE ON public.customer_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_customer_registration_payment();

CREATE OR REPLACE FUNCTION public.recalculate_agent_airtel_earnings(p_agent_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  total INTEGER := 0;
  paid_sum INTEGER := 0;
BEGIN
  SELECT COALESCE(SUM(approved_amount_kes), 0)::INTEGER INTO total
  FROM public.customer_registrations
  WHERE agent_id = p_agent_id
    AND status = 'approved'
    AND approved_amount_kes IS NOT NULL
    AND approved_amount_kes > 0
    AND COALESCE(commission_exempt, false) = false;

  SELECT COALESCE(SUM(amount_ksh), 0)::INTEGER INTO paid_sum
  FROM public.agent_payments
  WHERE agent_id = p_agent_id;

  UPDATE public.agents
  SET
    total_earnings = total,
    available_balance = GREATEST(0, total - paid_sum),
    updated_at = NOW()
  WHERE id = p_agent_id;

  RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_agent_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalculate_agent_airtel_earnings(COALESCE(NEW.agent_id, OLD.agent_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS update_agent_balance_on_insert ON public.customer_registrations;
DROP TRIGGER IF EXISTS update_agent_balance_on_update ON public.customer_registrations;
DROP TRIGGER IF EXISTS update_agent_balance_on_commission ON public.customer_registrations;
DROP TRIGGER IF EXISTS update_agent_balance_on_approval ON public.customer_registrations;

CREATE TRIGGER update_agent_balance_on_insert
  AFTER INSERT ON public.customer_registrations
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION public.update_agent_balance();

CREATE TRIGGER update_agent_balance_on_update
  AFTER UPDATE OF status ON public.customer_registrations
  FOR EACH ROW
  WHEN (NEW.status = 'approved' OR OLD.status = 'approved')
  EXECUTE FUNCTION public.update_agent_balance();

CREATE TRIGGER update_agent_balance_on_approval
  AFTER UPDATE OF approved_amount_kes ON public.customer_registrations
  FOR EACH ROW
  WHEN (OLD.approved_amount_kes IS DISTINCT FROM NEW.approved_amount_kes)
  EXECUTE FUNCTION public.update_agent_balance();

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
      'Payment for ''%s'' is approved. You earned KSh %s.',
      customer_name,
      COALESCE(NEW.approved_amount_kes, 0)
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
        'amount', NEW.approved_amount_kes
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

DO $$
DECLARE
  agent_record RECORD;
BEGIN
  FOR agent_record IN SELECT id FROM public.agents LOOP
    PERFORM public.recalculate_agent_airtel_earnings(agent_record.id);
  END LOOP;
END $$;
