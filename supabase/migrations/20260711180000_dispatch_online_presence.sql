-- Online presence + offer expiry sweep support (v1.1)
-- No pg_cron: stale offers are swept on dispatch, agent heartbeat, and admin poll.

ALTER TABLE public.dispatch_config
  ADD COLUMN IF NOT EXISTS online_presence_minutes INTEGER NOT NULL DEFAULT 5
    CHECK (online_presence_minutes BETWEEN 1 AND 60);

COMMENT ON COLUMN public.dispatch_config.online_presence_minutes IS
  'Agent counts as online when last_seen_at is within this many minutes (app heartbeat).';

ALTER TABLE public.agent_dispatch_settings
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN public.agent_dispatch_settings.last_seen_at IS
  'Updated by agent app heartbeat while signed in. Used to prefer online agents for offers.';

CREATE INDEX IF NOT EXISTS idx_lead_offers_stale_offered
  ON public.lead_offers (expires_at)
  WHERE status = 'offered';
