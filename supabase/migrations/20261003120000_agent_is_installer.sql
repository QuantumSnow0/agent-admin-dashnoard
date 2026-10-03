-- Agents are installers unless ops marks them as non-installers.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS is_installer boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.agents.is_installer IS
  'False when the agent is a non-installer. Existing agents stay installers.';

CREATE INDEX IF NOT EXISTS agents_non_installer_idx
  ON public.agents (is_installer)
  WHERE is_installer = false;
