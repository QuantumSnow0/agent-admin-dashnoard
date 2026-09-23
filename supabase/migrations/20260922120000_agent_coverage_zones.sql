-- Admin-assigned coverage zones (pin + radius + priority).
-- Agents with at least one row here match by zone. Others keep working-pin + radius.

ALTER TABLE public.dispatch_config
  ADD COLUMN IF NOT EXISTS overlap_daily_accept_cap INT NOT NULL DEFAULT 5;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_config_overlap_daily_accept_cap_check'
  ) THEN
    ALTER TABLE public.dispatch_config
      ADD CONSTRAINT dispatch_config_overlap_daily_accept_cap_check
      CHECK (overlap_daily_accept_cap >= 0 AND overlap_daily_accept_cap <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.dispatch_config.overlap_daily_accept_cap IS
  'When more than one agent covers a customer, skip agents who already accepted this many offers in the last 24 hours. 0 disables the cap.';

ALTER TABLE public.agent_dispatch_settings
  ADD COLUMN IF NOT EXISTS pin_coverage_priority INT NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_dispatch_settings_pin_coverage_priority_check'
  ) THEN
    ALTER TABLE public.agent_dispatch_settings
      ADD CONSTRAINT agent_dispatch_settings_pin_coverage_priority_check
      CHECK (pin_coverage_priority >= 1 AND pin_coverage_priority <= 1000);
  END IF;
END $$;

COMMENT ON COLUMN public.agent_dispatch_settings.pin_coverage_priority IS
  'When this pin-only agent overlaps a zoned agent, lower number is offered first. Default 100.';

CREATE TABLE IF NOT EXISTS public.agent_coverage_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  place_id TEXT,
  formatted_address TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_km NUMERIC(6, 2) NOT NULL,
  priority INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_coverage_zones_lat_check CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT agent_coverage_zones_lng_check CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT agent_coverage_zones_radius_check CHECK (radius_km >= 0.5 AND radius_km <= 50),
  CONSTRAINT agent_coverage_zones_priority_check CHECK (priority >= 1 AND priority <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_agent_coverage_zones_agent
  ON public.agent_coverage_zones (agent_id);

COMMENT ON TABLE public.agent_coverage_zones IS
  'Admin-drawn coverage circles. If an agent has any rows, dispatch uses these instead of working-pin radius.';

ALTER TABLE public.agent_coverage_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read coverage zones" ON public.agent_coverage_zones;
CREATE POLICY "Admins read coverage zones"
  ON public.agent_coverage_zones FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.agents a WHERE a.id = auth.uid() AND a.is_admin)
  );

DROP POLICY IF EXISTS "Admins write coverage zones" ON public.agent_coverage_zones;
CREATE POLICY "Admins write coverage zones"
  ON public.agent_coverage_zones FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.agents a WHERE a.id = auth.uid() AND a.is_admin)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.agents a WHERE a.id = auth.uid() AND a.is_admin)
  );
