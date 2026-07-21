-- Allow unlimited open-lead caps: remove upper bound (was 1–50) and add a disable toggle.

ALTER TABLE public.dispatch_config
  DROP CONSTRAINT IF EXISTS dispatch_config_max_open_leads_per_agent_check;

ALTER TABLE public.dispatch_config
  ADD CONSTRAINT dispatch_config_max_open_leads_per_agent_check
  CHECK (max_open_leads_per_agent >= 1);

ALTER TABLE public.dispatch_config
  ADD COLUMN IF NOT EXISTS max_open_leads_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.dispatch_config.max_open_leads_enabled IS
  'When false, auto-dispatch ignores max_open_leads_per_agent (no open-lead cap).';

COMMENT ON COLUMN public.dispatch_config.max_open_leads_per_agent IS
  'Max open assigned leads per agent when max_open_leads_enabled is true. Minimum 1; no upper bound.';
