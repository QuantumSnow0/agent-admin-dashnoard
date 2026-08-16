-- =============================================================================
-- Agent working pin (Google Places) + service radius columns
-- =============================================================================
-- Run on hub Supabase (olaounggwgxpbenmuvnl) if this migration is not applied.
-- Same statements: admin-dashboard/sql/add_agent_working_place.sql
-- Does not change matching. Matching still uses town centroids until a later change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Agent working place (Google pin)
-- -----------------------------------------------------------------------------
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS working_place JSONB;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS working_place_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.agents.working_place IS
  'Google Places working pin: placeId, name, formattedAddress, lat, lng, county, locality, neighborhood. Agents set this via Places search only (no GPS).';

COMMENT ON COLUMN public.agents.working_place_updated_at IS
  'When the agent last saved working_place. Shown in the app as last updated.';

CREATE INDEX IF NOT EXISTS idx_agents_working_place_updated
  ON public.agents (working_place_updated_at)
  WHERE working_place IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Global default radius (8 km) — no-op if canonical locations migration ran
-- -----------------------------------------------------------------------------
ALTER TABLE public.dispatch_config
  ADD COLUMN IF NOT EXISTS default_service_radius_km NUMERIC(6, 2);

UPDATE public.dispatch_config
SET default_service_radius_km = 8
WHERE default_service_radius_km IS NULL;

ALTER TABLE public.dispatch_config
  ALTER COLUMN default_service_radius_km SET DEFAULT 8,
  ALTER COLUMN default_service_radius_km SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_config_default_service_radius_km_check'
  ) THEN
    ALTER TABLE public.dispatch_config
      ADD CONSTRAINT dispatch_config_default_service_radius_km_check
      CHECK (default_service_radius_km > 0 AND default_service_radius_km <= 50);
  END IF;
END $$;

COMMENT ON COLUMN public.dispatch_config.default_service_radius_km IS
  'Global default agent service radius in km. Agents may override via agent_dispatch_settings.service_radius_km.';

-- -----------------------------------------------------------------------------
-- 3. Per-agent radius override — no-op if canonical locations migration ran
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_dispatch_settings
  ADD COLUMN IF NOT EXISTS service_radius_km NUMERIC(6, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_dispatch_settings_service_radius_km_check'
  ) THEN
    ALTER TABLE public.agent_dispatch_settings
      ADD CONSTRAINT agent_dispatch_settings_service_radius_km_check
      CHECK (
        service_radius_km IS NULL
        OR (service_radius_km > 0 AND service_radius_km <= 50)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.agent_dispatch_settings.service_radius_km IS
  'Optional per-agent radius override in km. NULL means use dispatch_config.default_service_radius_km.';

-- -----------------------------------------------------------------------------
-- 4. Copy working_place from signup metadata when handle_new_user still runs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  place jsonb;
BEGIN
  place := CASE
    WHEN jsonb_typeof(NEW.raw_user_meta_data->'working_place') = 'object'
      THEN NEW.raw_user_meta_data->'working_place'
    ELSE NULL
  END;

  INSERT INTO public.agents (
    id,
    email,
    name,
    airtel_phone,
    safaricom_phone,
    town,
    area,
    working_place,
    working_place_updated_at,
    status,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'airtel_phone', NULL),
    COALESCE(NEW.raw_user_meta_data->>'safaricom_phone', NULL),
    COALESCE(NEW.raw_user_meta_data->>'town', NULL),
    COALESCE(NEW.raw_user_meta_data->>'area', NULL),
    place,
    CASE WHEN place IS NOT NULL THEN NOW() ELSE NULL END,
    'pending',
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, agents.name),
    email = EXCLUDED.email,
    working_place = COALESCE(EXCLUDED.working_place, agents.working_place),
    working_place_updated_at = COALESCE(
      EXCLUDED.working_place_updated_at,
      agents.working_place_updated_at
    );

  RETURN NEW;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'Error creating agent profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
