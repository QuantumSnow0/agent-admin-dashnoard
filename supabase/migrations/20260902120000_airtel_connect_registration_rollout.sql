-- =============================================================================
-- Airtel Connect registration rollout (county-controlled + global kill switch)
-- Coexists with legacy WAM registration — nothing enabled by default.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Global kill switch (single-row)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registration_rollout_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtel_connect_rollout_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_rollout_config_single
  ON public.registration_rollout_config ((1));

INSERT INTO public.registration_rollout_config (airtel_connect_rollout_enabled)
SELECT FALSE
WHERE NOT EXISTS (SELECT 1 FROM public.registration_rollout_config);

COMMENT ON TABLE public.registration_rollout_config IS
  'Global kill switch for Airtel Connect registration workflow. OFF = all agents use legacy_wam.';

-- -----------------------------------------------------------------------------
-- 2. Per-county registration mode
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registration_county_modes (
  county TEXT PRIMARY KEY,
  registration_mode TEXT NOT NULL DEFAULT 'legacy_wam'
    CHECK (registration_mode IN ('legacy_wam', 'airtel_connect')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.registration_county_modes IS
  'County → registration_mode. Only consulted when global rollout is enabled.';

-- Seed all known v1 counties as legacy (explicit; safe default).
INSERT INTO public.registration_county_modes (county, registration_mode)
SELECT DISTINCT county, 'legacy_wam'
FROM public.location_reference
ON CONFLICT (county) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Extend customer_registrations for Airtel Connect workflow
-- -----------------------------------------------------------------------------
ALTER TABLE public.customer_registrations
  ADD COLUMN IF NOT EXISTS registration_workflow TEXT NOT NULL DEFAULT 'legacy_wam'
    CHECK (registration_workflow IN ('legacy_wam', 'airtel_connect')),
  ADD COLUMN IF NOT EXISTS client_handoff_id TEXT,
  ADD COLUMN IF NOT EXISTS airtel_connect_handoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS airtel_connect_handoff_status TEXT
    CHECK (
      airtel_connect_handoff_status IS NULL
      OR airtel_connect_handoff_status IN ('pending', 'launched', 'play_store', 'failed')
    );

-- Legacy-only fields optional for airtel_connect workflow rows.
ALTER TABLE public.customer_registrations
  ALTER COLUMN alternate_number DROP NOT NULL,
  ALTER COLUMN visit_date DROP NOT NULL,
  ALTER COLUMN visit_time DROP NOT NULL;

-- installation_town optional for airtel_connect (location captured without town picker).
ALTER TABLE public.customer_registrations
  ALTER COLUMN installation_town DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_registrations_agent_handoff
  ON public.customer_registrations (agent_id, client_handoff_id)
  WHERE client_handoff_id IS NOT NULL;

COMMENT ON COLUMN public.customer_registrations.registration_workflow IS
  'legacy_wam | airtel_connect — which client workflow created this row.';
COMMENT ON COLUMN public.customer_registrations.client_handoff_id IS
  'Client-generated idempotency key for Airtel Connect handoff submissions.';

-- -----------------------------------------------------------------------------
-- 4. Trusted agent county resolution
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_agent_registration_county(p_agent_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    nullif(btrim(ads.county), ''),
    public.resolve_county_from_town(a.town),
    nullif(btrim(a.working_place->>'county'), '')
  )
  FROM public.agents a
  LEFT JOIN public.agent_dispatch_settings ads ON ads.agent_id = a.id
  WHERE a.id = p_agent_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_agent_registration_county(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_agent_registration_county(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. County key normalization (Kiambu vs Kiambu County, etc.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_registration_county_key(p_county TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_county IS NULL OR btrim(p_county) = '' THEN NULL
    ELSE lower(regexp_replace(btrim(p_county), '\s+county\s*$', '', 'i'))
  END;
$$;

COMMENT ON FUNCTION public.normalize_registration_county_key(TEXT) IS
  'Canonical county key for rollout lookup: trim, lower, strip trailing " County".';

-- -----------------------------------------------------------------------------
-- 6. Registration mode for authenticated agent (fail-safe → legacy_wam)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_registration_mode()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_agent_id UUID := auth.uid();
  v_county TEXT;
  v_county_key TEXT;
  v_global BOOLEAN;
  v_mode TEXT;
BEGIN
  IF v_agent_id IS NULL THEN
    RETURN jsonb_build_object(
      'mode', 'legacy_wam',
      'reason', 'unauthenticated'
    );
  END IF;

  SELECT coalesce(airtel_connect_rollout_enabled, FALSE)
  INTO v_global
  FROM public.registration_rollout_config
  LIMIT 1;

  IF NOT coalesce(v_global, FALSE) THEN
    RETURN jsonb_build_object(
      'mode', 'legacy_wam',
      'reason', 'global_kill_switch',
      'global_enabled', FALSE
    );
  END IF;

  v_county := public.resolve_agent_registration_county(v_agent_id);
  v_county_key := public.normalize_registration_county_key(v_county);

  IF v_county_key IS NULL THEN
    RETURN jsonb_build_object(
      'mode', 'legacy_wam',
      'reason', 'no_trusted_county',
      'global_enabled', TRUE,
      'county', NULL
    );
  END IF;

  SELECT rcm.registration_mode
  INTO v_mode
  FROM public.registration_county_modes rcm
  WHERE public.normalize_registration_county_key(rcm.county) = v_county_key;

  IF v_mode = 'airtel_connect' THEN
    RETURN jsonb_build_object(
      'mode', 'airtel_connect',
      'county', v_county,
      'global_enabled', TRUE
    );
  END IF;

  RETURN jsonb_build_object(
    'mode', 'legacy_wam',
    'reason', 'county_not_enabled',
    'county', v_county,
    'global_enabled', TRUE
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_my_registration_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_registration_mode() TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. RLS — read rollout config; county modes admin-managed (service role)
-- -----------------------------------------------------------------------------
ALTER TABLE public.registration_rollout_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_county_modes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read registration rollout config"
  ON public.registration_rollout_config;
CREATE POLICY "Authenticated read registration rollout config"
  ON public.registration_rollout_config
  FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Authenticated read registration county modes"
  ON public.registration_county_modes;
CREATE POLICY "Authenticated read registration county modes"
  ON public.registration_county_modes
  FOR SELECT
  TO authenticated
  USING (TRUE);
