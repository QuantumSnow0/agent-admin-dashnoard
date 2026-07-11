-- =============================================================================
-- Lead dispatch v1 — inbound website leads → nearest agent in county
-- =============================================================================
-- Design goals:
--   • Extensible via metadata JSONB columns and dispatch_config toggles
--   • Status/outcome enums can grow in future migrations (avoid tight coupling)
--   • MS Forms / referrals / GPS are out of scope here (separate features)
-- See: admin-dashboard/lib/dispatch/README.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Global dispatch settings (single-row pattern, like ms_forms_config)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  offer_timeout_minutes INT NOT NULL DEFAULT 15
    CHECK (offer_timeout_minutes BETWEEN 1 AND 120),
  sla_hours INT NOT NULL DEFAULT 24
    CHECK (sla_hours BETWEEN 1 AND 168),
  max_open_leads_per_agent INT NOT NULL DEFAULT 3
    CHECK (max_open_leads_per_agent BETWEEN 1 AND 50),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Room for v2: push templates, auto-reassign flags, county overrides, etc.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_config_single ON public.dispatch_config ((1));

INSERT INTO public.dispatch_config (dispatch_enabled)
SELECT TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.dispatch_config);

COMMENT ON TABLE public.dispatch_config IS
  'v1: Global lead-dispatch knobs. Extend via metadata or new columns in later migrations.';

-- -----------------------------------------------------------------------------
-- 2. Town → county + centroid reference (v1 nearest-agent within county)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.location_reference (
  town_key TEXT PRIMARY KEY,
  town_label TEXT NOT NULL,
  county TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.location_reference IS
  'Maps installation/agent towns to county and approximate centroid for distance ranking.';

-- Seed Airtel v1 towns (extend with more towns/counties in future migrations).
INSERT INTO public.location_reference (town_key, town_label, county, latitude, longitude)
VALUES
  ('bungoma', 'Bungoma', 'Bungoma', -0.5697, 34.5584),
  ('eldoret', 'Eldoret', 'Uasin Gishu', 0.5143, 35.2698),
  ('garissa', 'Garissa', 'Garissa', -0.4532, 39.6461),
  ('kakamega', 'Kakamega', 'Kakamega', 0.2827, 34.7519),
  ('kilifi', 'Kilifi', 'Kilifi', -3.6305, 39.8499),
  ('kisii', 'Kisii', 'Kisii', -0.6773, 34.7796),
  ('kisumu', 'Kisumu', 'Kisumu', -0.1022, 34.7617),
  ('kitale', 'Kitale', 'Trans Nzoia', 1.0167, 35.0000),
  ('machakos', 'Machakos', 'Machakos', -1.5177, 37.2634),
  ('meru', 'Meru', 'Meru', 0.0469, 37.6559),
  ('migori', 'Migori', 'Migori', -1.0634, 34.4731),
  ('mombasa', 'Mombasa', 'Mombasa', -4.0435, 39.6682),
  ('nairobi', 'Nairobi', 'Nairobi', -1.2921, 36.8219),
  ('nakuru', 'Nakuru', 'Nakuru', -0.3031, 36.0800)
ON CONFLICT (town_key) DO NOTHING;

-- Helper: normalize town label to lookup key
CREATE OR REPLACE FUNCTION public.normalize_town_key(p_town TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(regexp_replace(coalesce(p_town, ''), '\s+', ' ', 'g')));
$$;

-- Helper: resolve county from installation town (v1; override via lead.county when set)
CREATE OR REPLACE FUNCTION public.resolve_county_from_town(p_town TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT lr.county
  FROM public.location_reference lr
  WHERE lr.town_key = public.normalize_town_key(p_town)
  LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 3. Agent dispatch scope + availability (extends agents without bloating row)
-- -----------------------------------------------------------------------------
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS lead_dispatch_scope TEXT NOT NULL DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_lead_dispatch_scope_check'
  ) THEN
    ALTER TABLE public.agents
      ADD CONSTRAINT agents_lead_dispatch_scope_check
      CHECK (lead_dispatch_scope IN ('both', 'airtel', 'safaricom', 'none'));
  END IF;
END $$;

COMMENT ON COLUMN public.agents.lead_dispatch_scope IS
  'v1: both | airtel | safaricom | none — admin toggles which inbound products an agent receives.';

CREATE TABLE IF NOT EXISTS public.agent_dispatch_settings (
  agent_id UUID PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  -- Cached county from agents.town for faster matching (refresh via trigger/app)
  county TEXT,
  -- v2: live GPS when agent goes online
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  last_available_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.agent_dispatch_settings IS
  'Per-agent dispatch state. is_available=true means agent can receive offers.';

-- Auto-create settings row when agent is approved (optional backfill for existing agents)
INSERT INTO public.agent_dispatch_settings (agent_id, county)
SELECT a.id, public.resolve_county_from_town(a.town)
FROM public.agents a
WHERE a.status = 'approved'
ON CONFLICT (agent_id) DO NOTHING;

-- Keep county cache in sync when agent town changes
CREATE OR REPLACE FUNCTION public.sync_agent_dispatch_county()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.agent_dispatch_settings (agent_id, county)
  VALUES (NEW.id, public.resolve_county_from_town(NEW.town))
  ON CONFLICT (agent_id) DO UPDATE
    SET county = public.resolve_county_from_town(NEW.town),
        updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_agent_dispatch_county ON public.agents;
CREATE TRIGGER trg_sync_agent_dispatch_county
  AFTER INSERT OR UPDATE OF town ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_agent_dispatch_county();

-- -----------------------------------------------------------------------------
-- 4. Inbound leads (website + future agent_own)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inbound_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Provenance
  source TEXT NOT NULL
    CHECK (source IN ('airtel5grouter', 'internetkenya', 'agent_own')),
  source_external_id TEXT,
  product TEXT NOT NULL CHECK (product IN ('airtel', 'safaricom')),

  -- Lifecycle (v1 — add values in new migrations if needed)
  status TEXT NOT NULL DEFAULT 'pending_dispatch'
    CHECK (status IN (
      'pending_dispatch',
      'offered',
      'assigned',
      'kyc_in_progress',
      'kyc_completed',
      'installed',
      'needs_reassignment',
      'admin_queue',
      'lost',
      'expired'
    )),

  -- Geography (county is matching boundary for v1)
  county TEXT,
  installation_town TEXT,
  installation_area TEXT,
  delivery_landmark TEXT,

  -- Customer PII — hidden from agents until offer accepted
  customer_name TEXT NOT NULL,
  primary_phone TEXT NOT NULL,
  alternate_phone TEXT,
  email TEXT,

  -- Plan / schedule
  preferred_package TEXT,
  plan_label TEXT,
  plan_group TEXT,
  visit_date DATE,
  visit_time TEXT,

  -- Safaricom extras (nullable for Airtel)
  national_id TEXT,
  date_of_birth DATE,

  -- Assignment & KYC tracking
  assigned_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  kyc_started_at TIMESTAMPTZ,
  kyc_completed_at TIMESTAMPTZ,
  installed_at TIMESTAMPTZ,
  kyc_outcome TEXT
    CHECK (kyc_outcome IS NULL OR kyc_outcome IN (
      'completed', 'unreachable', 'declined', 'kyc_failed'
    )),

  -- Proof of install (required when agent marks installed)
  airtel_sr_number TEXT,
  safaricom_imei TEXT,

  reassignment_count INT NOT NULL DEFAULT 0,
  dedupe_phone_key TEXT NOT NULL,

  -- Optional link to customer_registrations / safaricom_registrations (v2)
  registration_id UUID,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_inbound_leads_status ON public.inbound_leads (status);
CREATE INDEX IF NOT EXISTS idx_inbound_leads_county ON public.inbound_leads (county);
CREATE INDEX IF NOT EXISTS idx_inbound_leads_product ON public.inbound_leads (product);
CREATE INDEX IF NOT EXISTS idx_inbound_leads_assigned_agent ON public.inbound_leads (assigned_agent_id)
  WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_leads_dedupe ON public.inbound_leads (dedupe_phone_key);
CREATE INDEX IF NOT EXISTS idx_inbound_leads_created_at ON public.inbound_leads (created_at DESC);

COMMENT ON TABLE public.inbound_leads IS
  'v1: Inbound marketing leads awaiting dispatch and agent KYC/install tracking.';
COMMENT ON COLUMN public.inbound_leads.airtel_sr_number IS
  'Required when agent marks Airtel lead installed.';
COMMENT ON COLUMN public.inbound_leads.safaricom_imei IS
  'Required when agent marks Safaricom lead installed.';

-- -----------------------------------------------------------------------------
-- 5. Lead offers (blind offer → accept / decline / expire)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.inbound_leads(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered', 'accepted', 'declined', 'expired', 'superseded')),
  offer_sequence INT NOT NULL DEFAULT 1,
  distance_km DOUBLE PRECISION,
  -- Blind preview shown before accept (no PII)
  preview_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_lead_offers_lead ON public.lead_offers (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_offers_agent ON public.lead_offers (agent_id);
CREATE INDEX IF NOT EXISTS idx_lead_offers_active ON public.lead_offers (agent_id, status)
  WHERE status = 'offered';

COMMENT ON TABLE public.lead_offers IS
  'v1: One agent at a time per lead; preview_payload is safe to show before accept.';

-- -----------------------------------------------------------------------------
-- 6. updated_at trigger for inbound_leads
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_inbound_leads_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inbound_leads_updated_at ON public.inbound_leads;
CREATE TRIGGER trg_inbound_leads_updated_at
  BEFORE UPDATE ON public.inbound_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_inbound_leads_updated_at();

-- -----------------------------------------------------------------------------
-- 7. Extend notification types for lead dispatch
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_type_check'
  ) THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'REGISTRATION_STATUS_CHANGE',
    'EARNINGS_UPDATE',
    'ACCOUNT_STATUS_CHANGE',
    'SYNC_FAILURE',
    'SYSTEM_ANNOUNCEMENT',
    'PAYOUT_RECEIVED',
    'LEAD_OFFER',
    'LEAD_OVERDUE'
  ));

-- -----------------------------------------------------------------------------
-- 8. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.dispatch_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_dispatch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_offers ENABLE ROW LEVEL SECURITY;

-- dispatch_config: authenticated read (agents need timeouts for UI countdown)
DROP POLICY IF EXISTS "Authenticated read dispatch config" ON public.dispatch_config;
CREATE POLICY "Authenticated read dispatch config"
  ON public.dispatch_config FOR SELECT TO authenticated USING (TRUE);

-- location_reference: read-only for authenticated (preview labels)
DROP POLICY IF EXISTS "Authenticated read location reference" ON public.location_reference;
CREATE POLICY "Authenticated read location reference"
  ON public.location_reference FOR SELECT TO authenticated USING (TRUE);

-- agent_dispatch_settings: agents manage own row
DROP POLICY IF EXISTS "Agents read own dispatch settings" ON public.agent_dispatch_settings;
CREATE POLICY "Agents read own dispatch settings"
  ON public.agent_dispatch_settings FOR SELECT
  USING (auth.uid() = agent_id);

DROP POLICY IF EXISTS "Agents update own dispatch settings" ON public.agent_dispatch_settings;
CREATE POLICY "Agents update own dispatch settings"
  ON public.agent_dispatch_settings FOR UPDATE
  USING (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

DROP POLICY IF EXISTS "Agents insert own dispatch settings" ON public.agent_dispatch_settings;
CREATE POLICY "Agents insert own dispatch settings"
  ON public.agent_dispatch_settings FOR INSERT
  WITH CHECK (auth.uid() = agent_id);

-- inbound_leads: agents only see leads assigned to them (full PII after accept)
DROP POLICY IF EXISTS "Agents read assigned inbound leads" ON public.inbound_leads;
CREATE POLICY "Agents read assigned inbound leads"
  ON public.inbound_leads FOR SELECT
  USING (auth.uid() = assigned_agent_id);

-- lead_offers: agents see their own offers (preview in preview_payload)
DROP POLICY IF EXISTS "Agents read own lead offers" ON public.lead_offers;
CREATE POLICY "Agents read own lead offers"
  ON public.lead_offers FOR SELECT
  USING (auth.uid() = agent_id);

DROP POLICY IF EXISTS "Agents update own lead offers" ON public.lead_offers;
CREATE POLICY "Agents update own lead offers"
  ON public.lead_offers FOR UPDATE
  USING (auth.uid() = agent_id)
  WITH CHECK (auth.uid() = agent_id);

-- Service role / edge functions bypass RLS for inserts and dispatch logic.
