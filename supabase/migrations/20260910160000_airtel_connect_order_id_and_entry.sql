-- Airtel Connect dual entry paths + Order ID (payment reference).
ALTER TABLE public.customer_registrations
  ADD COLUMN IF NOT EXISTS airtel_connect_entry text
    CHECK (
      airtel_connect_entry IS NULL
      OR airtel_connect_entry IN ('wam_first', 'connect_first')
    ),
  ADD COLUMN IF NOT EXISTS airtel_connect_order_id text;

COMMENT ON COLUMN public.customer_registrations.airtel_connect_entry IS
  'wam_first = save in WAM then Connect KYC; connect_first = started in Connect then finish in WAM.';
COMMENT ON COLUMN public.customer_registrations.airtel_connect_order_id IS
  'Airtel Connect Order ID — shared reference for payments/ops. Optional to save; needed for payment.';

CREATE INDEX IF NOT EXISTS idx_customer_registrations_connect_order_id
  ON public.customer_registrations (airtel_connect_order_id)
  WHERE airtel_connect_order_id IS NOT NULL;

-- Agents may update Order ID on their own Connect registrations (payment follow-up).
DROP POLICY IF EXISTS "Agents can update own airtel connect order id" ON public.customer_registrations;
CREATE POLICY "Agents can update own airtel connect order id"
  ON public.customer_registrations
  FOR UPDATE
  TO authenticated
  USING (agent_id = auth.uid())
  WITH CHECK (agent_id = auth.uid());
