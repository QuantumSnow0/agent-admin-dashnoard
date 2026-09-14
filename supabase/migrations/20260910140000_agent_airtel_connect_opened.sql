-- Track agents who already have an Airtel Connect (external app) account opened.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS airtel_connect_opened boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS airtel_connect_opened_at timestamptz NULL;

COMMENT ON COLUMN public.agents.airtel_connect_opened IS
  'Ops flag: WAM has opened an Airtel Connect app account for this agent.';
COMMENT ON COLUMN public.agents.airtel_connect_opened_at IS
  'When airtel_connect_opened was last set to true.';

CREATE INDEX IF NOT EXISTS agents_airtel_connect_opened_idx
  ON public.agents (airtel_connect_opened)
  WHERE airtel_connect_opened = true;
