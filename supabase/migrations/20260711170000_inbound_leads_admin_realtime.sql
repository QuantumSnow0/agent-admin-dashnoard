-- Admin dashboard: read inbound dispatch tables + Realtime for /dashboard/leads
-- Agent hub only: olaounggwgxpbenmuvnl

DROP POLICY IF EXISTS "Admins read all inbound leads" ON public.inbound_leads;
CREATE POLICY "Admins read all inbound leads"
  ON public.inbound_leads
  FOR SELECT
  TO authenticated
  USING (is_user_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins read all lead offers" ON public.lead_offers;
CREATE POLICY "Admins read all lead offers"
  ON public.lead_offers
  FOR SELECT
  TO authenticated
  USING (is_user_admin(auth.uid()));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'inbound_leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inbound_leads;
  END IF;
END $$;

COMMENT ON TABLE public.inbound_leads IS
  'v1: Inbound marketing leads. Realtime-enabled for admin queue dashboard.';
