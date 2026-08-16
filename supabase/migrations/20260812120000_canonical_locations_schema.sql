-- =============================================================================
-- Canonical locations schema (Agent Hub)
-- =============================================================================
-- Step 1 of LOCATION_DATABASE_SCHEMA.md:
--   create new tables + nullable columns on existing dispatch tables.
-- Does NOT import ArcGIS data, seed ISP town lists, migrate agents/leads,
-- or change dispatch matching.
-- location_reference and county matching remain the live v1 path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Dataset versions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.location_dataset_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  checksum TEXT NOT NULL,
  feature_count INT NOT NULL CHECK (feature_count >= 0),
  spatial_ref_wkid INT NOT NULL,
  notes TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by TEXT,
  is_current BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS location_dataset_versions_checksum_key
  ON public.location_dataset_versions (checksum);

CREATE UNIQUE INDEX IF NOT EXISTS location_dataset_versions_one_current
  ON public.location_dataset_versions (is_current)
  WHERE is_current = TRUE;

COMMENT ON TABLE public.location_dataset_versions IS
  'Audit trail for ArcGIS imports. locations.id stays stable across versions.';

-- -----------------------------------------------------------------------------
-- 2. Canonical locations (gazetteer)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  province TEXT NOT NULL,
  district TEXT NOT NULL,
  division TEXT NOT NULL,
  name TEXT NOT NULL,
  display_label TEXT NOT NULL,
  slug TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL
    CHECK (latitude >= -90 AND latitude <= 90),
  longitude DOUBLE PRECISION NOT NULL
    CHECK (longitude >= -180 AND longitude <= 180),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  dataset_version_id UUID NOT NULL
    REFERENCES public.location_dataset_versions (id)
    ON DELETE RESTRICT,
  arcgis_fid INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT locations_hierarchy_key UNIQUE (province, district, division, name),
  CONSTRAINT locations_slug_key UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_locations_active
  ON public.locations (is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_locations_district_name
  ON public.locations (district, name);

CREATE INDEX IF NOT EXISTS idx_locations_name
  ON public.locations (name);

COMMENT ON TABLE public.locations IS
  'Canonical ArcGIS places. Identity is UUID + (province, district, division, name). Not ISP towns.';
COMMENT ON COLUMN public.locations.arcgis_fid IS
  'Provenance only. Not unique and not a join key.';
COMMENT ON COLUMN public.locations.latitude IS
  'Stored polygonal centroid in WGS84; used for dispatch distance.';

-- -----------------------------------------------------------------------------
-- 3. Polygon geometry (not for client catalog queries)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.location_geometries (
  location_id UUID PRIMARY KEY
    REFERENCES public.locations (id)
    ON DELETE CASCADE,
  geom_geojson JSONB NOT NULL,
  source_wkid INT NOT NULL,
  ring_count INT,
  vertex_count INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.location_geometries IS
  'EPSG:4326 GeoJSON polygons. Service-role / import only; not exposed to apps.';

-- -----------------------------------------------------------------------------
-- 4. ISP integration (Airtel now, Safaricom later)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.isp_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  installation_town_question_id TEXT,
  delivery_landmark_question_id TEXT,
  optional_field_question_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT isp_providers_code_key UNIQUE (code)
);

COMMENT ON TABLE public.isp_providers IS
  'ISP product adapters. Canonical geography does not live here.';

CREATE TABLE IF NOT EXISTS public.isp_installation_towns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL
    REFERENCES public.isp_providers (id)
    ON DELETE RESTRICT,
  town_key TEXT NOT NULL,
  town_label TEXT NOT NULL,
  location_question_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT isp_installation_towns_provider_key UNIQUE (provider_id, town_key)
);

CREATE INDEX IF NOT EXISTS idx_isp_installation_towns_provider
  ON public.isp_installation_towns (provider_id);

COMMENT ON TABLE public.isp_installation_towns IS
  'Provider operational town buckets (e.g. Airtel NAIROBI Forms column), not counties.';

CREATE TABLE IF NOT EXISTS public.isp_installation_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  isp_town_id UUID NOT NULL
    REFERENCES public.isp_installation_towns (id)
    ON DELETE RESTRICT,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT isp_installation_locations_town_label_key UNIQUE (isp_town_id, label)
);

CREATE INDEX IF NOT EXISTS idx_isp_installation_locations_town
  ON public.isp_installation_locations (isp_town_id);

COMMENT ON TABLE public.isp_installation_locations IS
  'Provider location labels under a town bucket, including estates with no ArcGIS row.';

CREATE TABLE IF NOT EXISTS public.location_isp_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL
    REFERENCES public.locations (id)
    ON DELETE RESTRICT,
  provider_id UUID NOT NULL
    REFERENCES public.isp_providers (id)
    ON DELETE RESTRICT,
  isp_town_id UUID NOT NULL
    REFERENCES public.isp_installation_towns (id)
    ON DELETE RESTRICT,
  isp_location_id UUID NOT NULL
    REFERENCES public.isp_installation_locations (id)
    ON DELETE RESTRICT,
  mapping_kind TEXT NOT NULL
    CHECK (mapping_kind IN ('exact_name', 'manual')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT location_isp_mappings_location_provider_key UNIQUE (location_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_location_isp_mappings_provider
  ON public.location_isp_mappings (provider_id);

CREATE INDEX IF NOT EXISTS idx_location_isp_mappings_provider_isp_location
  ON public.location_isp_mappings (provider_id, isp_location_id);

CREATE INDEX IF NOT EXISTS idx_location_isp_mappings_isp_town
  ON public.location_isp_mappings (isp_town_id);

COMMENT ON TABLE public.location_isp_mappings IS
  'Canonical location → provider town/location (e.g. Kinoo/Kiambu → Airtel NAIROBI/Kinoo).';

-- -----------------------------------------------------------------------------
-- 5. Agent extra-location requests and exceptions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_location_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL
    REFERENCES public.agents (id)
    ON DELETE CASCADE,
  location_id UUID NOT NULL
    REFERENCES public.locations (id)
    ON DELETE RESTRICT,
  distance_km NUMERIC(8, 3) NOT NULL CHECK (distance_km >= 0),
  effective_radius_km NUMERIC(6, 2) NOT NULL CHECK (effective_radius_km > 0),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  agent_note TEXT,
  admin_note TEXT,
  reviewed_by UUID
    REFERENCES public.agents (id)
    ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_location_requests_one_pending
  ON public.agent_location_requests (agent_id, location_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_location_requests_inbox
  ON public.agent_location_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_location_requests_agent
  ON public.agent_location_requests (agent_id);

COMMENT ON TABLE public.agent_location_requests IS
  'Agent requests to serve a canonical location outside radius. distance_km is snapshotted for admin review.';

CREATE TABLE IF NOT EXISTS public.agent_location_exceptions (
  agent_id UUID NOT NULL
    REFERENCES public.agents (id)
    ON DELETE CASCADE,
  location_id UUID NOT NULL
    REFERENCES public.locations (id)
    ON DELETE RESTRICT,
  request_id UUID
    REFERENCES public.agent_location_requests (id)
    ON DELETE SET NULL,
  granted_by UUID NOT NULL
    REFERENCES public.agents (id)
    ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (agent_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_location_exceptions_active
  ON public.agent_location_exceptions (agent_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.agent_location_exceptions IS
  'Admin-granted extra canonical locations. Dispatch reads rows where revoked_at IS NULL.';

-- -----------------------------------------------------------------------------
-- 6. Extend existing hub tables (nullable / defaulted; no data backfill)
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

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS base_location_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_base_location_id_fkey'
  ) THEN
    ALTER TABLE public.agents
      ADD CONSTRAINT agents_base_location_id_fkey
      FOREIGN KEY (base_location_id)
      REFERENCES public.locations (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agents_base_location
  ON public.agents (base_location_id)
  WHERE base_location_id IS NOT NULL;

COMMENT ON COLUMN public.agents.base_location_id IS
  'Canonical ArcGIS location this agent is based in. Nullable until backfill. Distinct from lead_dispatch_scope.';

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

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS installation_location_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inbound_leads_installation_location_id_fkey'
  ) THEN
    ALTER TABLE public.inbound_leads
      ADD CONSTRAINT inbound_leads_installation_location_id_fkey
      FOREIGN KEY (installation_location_id)
      REFERENCES public.locations (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inbound_leads_installation_location
  ON public.inbound_leads (installation_location_id)
  WHERE installation_location_id IS NOT NULL;

COMMENT ON COLUMN public.inbound_leads.installation_location_id IS
  'Canonical install place. Nullable until websites send it. v1 still uses installation_town strings.';

-- -----------------------------------------------------------------------------
-- 7. RLS
-- Service role / Edge Functions bypass RLS.
-- -----------------------------------------------------------------------------
ALTER TABLE public.location_dataset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_geometries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isp_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isp_installation_towns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isp_installation_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_isp_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_location_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_location_exceptions ENABLE ROW LEVEL SECURITY;

-- Catalog + ISP vocabulary: readable for signup (anon) and apps (authenticated).
-- Geometry has no SELECT policy → denied to clients.
DROP POLICY IF EXISTS "Read active locations" ON public.locations;
CREATE POLICY "Read active locations"
  ON public.locations FOR SELECT
  TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Authenticated read location dataset versions" ON public.location_dataset_versions;
CREATE POLICY "Authenticated read location dataset versions"
  ON public.location_dataset_versions FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Read active isp providers" ON public.isp_providers;
CREATE POLICY "Read active isp providers"
  ON public.isp_providers FOR SELECT
  TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Read active isp installation towns" ON public.isp_installation_towns;
CREATE POLICY "Read active isp installation towns"
  ON public.isp_installation_towns FOR SELECT
  TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Read active isp installation locations" ON public.isp_installation_locations;
CREATE POLICY "Read active isp installation locations"
  ON public.isp_installation_locations FOR SELECT
  TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Read location isp mappings" ON public.location_isp_mappings;
CREATE POLICY "Read location isp mappings"
  ON public.location_isp_mappings FOR SELECT
  TO anon, authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Agents read own location requests" ON public.agent_location_requests;
CREATE POLICY "Agents read own location requests"
  ON public.agent_location_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = agent_id);

DROP POLICY IF EXISTS "Agents insert own location requests" ON public.agent_location_requests;
CREATE POLICY "Agents insert own location requests"
  ON public.agent_location_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = agent_id AND status = 'pending');

DROP POLICY IF EXISTS "Agents cancel own pending location requests" ON public.agent_location_requests;
CREATE POLICY "Agents cancel own pending location requests"
  ON public.agent_location_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = agent_id AND status = 'pending')
  WITH CHECK (auth.uid() = agent_id AND status IN ('pending', 'cancelled'));

DROP POLICY IF EXISTS "Admins manage location requests" ON public.agent_location_requests;
CREATE POLICY "Admins manage location requests"
  ON public.agent_location_requests FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = auth.uid() AND a.is_admin = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = auth.uid() AND a.is_admin = TRUE
    )
  );

DROP POLICY IF EXISTS "Agents read own location exceptions" ON public.agent_location_exceptions;
CREATE POLICY "Agents read own location exceptions"
  ON public.agent_location_exceptions FOR SELECT
  TO authenticated
  USING (auth.uid() = agent_id);

DROP POLICY IF EXISTS "Admins manage location exceptions" ON public.agent_location_exceptions;
CREATE POLICY "Admins manage location exceptions"
  ON public.agent_location_exceptions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = auth.uid() AND a.is_admin = TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = auth.uid() AND a.is_admin = TRUE
    )
  );
