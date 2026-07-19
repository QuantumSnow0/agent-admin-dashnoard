-- Designated fallback agents: receive leads one-at-a-time when county matching
-- fails (no agent, all declined, unknown town) — before admin_queue.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS is_fallback_agent BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS fallback_priority INT NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.agents.is_fallback_agent IS
  'When true, agent can receive inbound offers after county matching fails, before admin_queue.';
COMMENT ON COLUMN public.agents.fallback_priority IS
  'Lower number = offered sooner among fallback agents (default 100).';

CREATE INDEX IF NOT EXISTS idx_agents_fallback
  ON public.agents (is_fallback_agent, fallback_priority)
  WHERE is_fallback_agent = TRUE AND status = 'approved';
