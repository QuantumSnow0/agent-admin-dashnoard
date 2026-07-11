-- Enable Realtime for lead_offers so the agent app can show offer modals
-- without requiring a push notification tap (foreground dispatch v1).
--
-- Run on agent hub only: olaounggwgxpbenmuvnl

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'lead_offers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_offers;
  END IF;
END $$;

COMMENT ON TABLE public.lead_offers IS
  'v1: One agent at a time per lead. Realtime-enabled for in-app offer modals.';
