-- Commission earnings must use actual units_required (rate × units).
-- The previous LEAST(2, …) cap under-counted legacy multi-unit installs.

CREATE OR REPLACE FUNCTION public.recalculate_agent_airtel_earnings(p_agent_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  cfg RECORD;
  reg RECORD;
  total INTEGER := 0;
  units INTEGER;
  pkg TEXT;
  paid_sum INTEGER := 0;
BEGIN
  SELECT standard_commission, premium_commission INTO cfg
  FROM public.commission_rates_config
  LIMIT 1;

  IF cfg IS NULL THEN
    cfg.standard_commission := 500;
    cfg.premium_commission := 700;
  END IF;

  FOR reg IN
    SELECT
      preferred_package,
      units_required,
      commission_package,
      commission_units
    FROM public.customer_registrations
    WHERE agent_id = p_agent_id
      AND status = 'installed'
  LOOP
    pkg := COALESCE(reg.commission_package, reg.preferred_package, 'standard');
    units := GREATEST(1, COALESCE(reg.commission_units, reg.units_required, 1));

    IF pkg = 'premium' THEN
      total := total + (cfg.premium_commission * units);
    ELSE
      total := total + (cfg.standard_commission * units);
    END IF;
  END LOOP;

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

-- Installed notification: use full effective units.
CREATE OR REPLACE FUNCTION create_registration_status_notification()
RETURNS TRIGGER AS $$
DECLARE
  notification_title TEXT;
  notification_message TEXT;
  customer_name TEXT;
  commission_amount INTEGER;
  package_type TEXT;
  units INTEGER;
  cfg RECORD;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;

  customer_name := NEW.customer_name;

  IF NEW.status = 'installed' THEN
    package_type := COALESCE(NEW.commission_package, NEW.preferred_package);
    units := GREATEST(1, COALESCE(NEW.commission_units, NEW.units_required, 1));

    SELECT standard_commission, premium_commission INTO cfg
    FROM public.commission_rates_config LIMIT 1;

    IF package_type = 'premium' THEN
      commission_amount := cfg.premium_commission * units;
    ELSE
      commission_amount := cfg.standard_commission * units;
    END IF;

    notification_title := 'Installation Completed';
    notification_message := format(
      'Customer ''%s'' installation has been completed. You earned KSh %s.',
      customer_name,
      commission_amount
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
        'amount', commission_amount
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
$$ LANGUAGE plpgsql;

-- Recalculate all agents after fix
DO $$
DECLARE
  agent_record RECORD;
BEGIN
  FOR agent_record IN SELECT id FROM public.agents LOOP
    PERFORM public.recalculate_agent_airtel_earnings(agent_record.id);
  END LOOP;
END $$;
