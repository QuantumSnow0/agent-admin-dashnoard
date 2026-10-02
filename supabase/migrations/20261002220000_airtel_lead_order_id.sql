-- An Airtel Order ID is used if it is already on a registration or another lead.

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
  )
  OR EXISTS (
    SELECT 1
    FROM public.inbound_leads
    WHERE product = 'airtel'
      AND airtel_sr_number IS NOT NULL
      AND btrim(airtel_sr_number) <> ''
      AND lower(btrim(airtel_sr_number)) = lower(btrim(COALESCE(p_order_id, '')))
      AND (p_exclude_id IS NULL OR id <> p_exclude_id)
  );
$$;

CREATE UNIQUE INDEX IF NOT EXISTS inbound_leads_airtel_order_id_unique
  ON public.inbound_leads (lower(btrim(airtel_sr_number)))
  WHERE product = 'airtel'
    AND airtel_sr_number IS NOT NULL
    AND btrim(airtel_sr_number) <> '';

-- Airtel leads that already have an Order ID are installed, waiting for payment.
UPDATE public.inbound_leads
SET
  status = 'installed',
  installed_at = COALESCE(installed_at, updated_at, now())
WHERE product = 'airtel'
  AND status = 'pending_install'
  AND airtel_sr_number IS NOT NULL
  AND btrim(airtel_sr_number) <> '';
