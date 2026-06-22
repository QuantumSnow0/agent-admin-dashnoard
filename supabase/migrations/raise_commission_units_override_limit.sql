-- Allow admin commission_units override above 2 for legacy multi-unit installs.

ALTER TABLE public.customer_registrations
  DROP CONSTRAINT IF EXISTS customer_registrations_commission_units_check;

ALTER TABLE public.customer_registrations
  ADD CONSTRAINT customer_registrations_commission_units_check
  CHECK (
    commission_units IS NULL
    OR (commission_units >= 1 AND commission_units <= 20)
  );

COMMENT ON COLUMN public.customer_registrations.commission_units IS
  'Admin override: units used for commission (NULL = use units_required). Up to 20 for legacy installs.';
