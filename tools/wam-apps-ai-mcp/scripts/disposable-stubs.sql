-- Minimal stubs for disposable PostgreSQL validation (synthetic; no production data).
-- Idempotent. Safe to re-run.

CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS vault;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END;
$roles$;

CREATE OR REPLACE FUNCTION public.admin_reverse_agent_payment(p_payment_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL; $$;
CREATE OR REPLACE FUNCTION public.agents_clear_dispatch_availability() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.agents_protect_self_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.create_payout_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.create_account_status_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.create_earnings_update_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.create_registration_status_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.recalculate_agent_airtel_earnings(p_agent_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT NULL; $$;
CREATE OR REPLACE FUNCTION public.update_agent_balance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.set_inbound_leads_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.sync_agent_dispatch_county() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.update_app_version_config_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.update_commission_rates_config_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.update_customer_registrations_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.update_device_tokens_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.update_safaricom_registrations_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;

CREATE TABLE IF NOT EXISTS public.dispatch_config (
  id int PRIMARY KEY,
  offer_timeout_minutes int,
  sla_hours int,
  default_service_radius_km numeric DEFAULT 8,
  online_presence_minutes int DEFAULT 5,
  max_open_leads_enabled boolean DEFAULT true,
  max_open_leads_per_agent int DEFAULT 3,
  dispatch_enabled boolean DEFAULT true
);
INSERT INTO public.dispatch_config (
  id, offer_timeout_minutes, sla_hours, default_service_radius_km,
  online_presence_minutes, max_open_leads_enabled, max_open_leads_per_agent, dispatch_enabled
) VALUES (1, 10, 24, 8, 5, false, 50, true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,
  airtel_phone text,
  safaricom_phone text,
  town text,
  area text,
  working_place jsonb,
  status text,
  lead_dispatch_scope text DEFAULT 'both',
  is_fallback_agent boolean DEFAULT false,
  fallback_priority int DEFAULT 100,
  total_earnings numeric DEFAULT 0,
  available_balance numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id),
  type text NOT NULL,
  title text,
  message text,
  is_read boolean DEFAULT false,
  read_at timestamptz,
  related_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE TABLE IF NOT EXISTS public.notification_push_receipts (
  notification_id uuid PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_dispatch_settings (
  agent_id uuid PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  is_available boolean DEFAULT false,
  county text,
  last_seen_at timestamptz,
  service_radius_km numeric,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inbound_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz,
  status text,
  source text,
  product text,
  county text,
  installation_town text,
  installation_area text,
  delivery_landmark text,
  customer_name text,
  primary_phone text,
  alternate_phone text,
  email text,
  national_id text,
  assigned_agent_id uuid REFERENCES public.agents(id),
  preferred_agent_id uuid REFERENCES public.agents(id),
  call_initiated_at timestamptz,
  kyc_started_at timestamptz,
  accepted_at timestamptz,
  kyc_completed_at timestamptz,
  callback_at timestamptz,
  installed_at timestamptz,
  kyc_outcome text,
  airtel_sr_number text,
  safaricom_imei text,
  commission_earned_ksh numeric,
  registration_id uuid,
  dedupe_phone_key text,
  plan_label text,
  preferred_package text,
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS preferred_agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS visit_date date;
ALTER TABLE public.inbound_leads
  ADD COLUMN IF NOT EXISTS visit_time text;

CREATE TABLE IF NOT EXISTS public.lead_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.inbound_leads(id),
  agent_id uuid REFERENCES public.agents(id),
  status text,
  offer_sequence int DEFAULT 1,
  distance_km double precision,
  preview_payload jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  responded_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.commission_rates_config (
  id int PRIMARY KEY DEFAULT 1,
  standard_commission numeric DEFAULT 500,
  premium_commission numeric DEFAULT 700
);
INSERT INTO public.commission_rates_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.customer_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id),
  inbound_lead_id uuid REFERENCES public.inbound_leads(id),
  customer_name text,
  airtel_number text,
  alternate_number text,
  email text,
  preferred_package text,
  commission_package text,
  commission_units integer,
  units_required integer,
  commission_exempt boolean DEFAULT false,
  installation_town text,
  delivery_landmark text,
  installation_location text,
  status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);

ALTER TABLE public.customer_registrations
  ADD COLUMN IF NOT EXISTS visit_date text;
ALTER TABLE public.customer_registrations
  ADD COLUMN IF NOT EXISTS visit_time text;

CREATE TABLE IF NOT EXISTS public.safaricom_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid,
  customer_name text,
  safaricom_number text,
  alternate_number text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz,
  status text
);

ALTER TABLE public.safaricom_registrations ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.safaricom_registrations ADD COLUMN IF NOT EXISTS safaricom_number text;
ALTER TABLE public.safaricom_registrations ADD COLUMN IF NOT EXISTS alternate_number text;
ALTER TABLE public.safaricom_registrations ADD COLUMN IF NOT EXISTS service_package text;
ALTER TABLE public.safaricom_registrations ADD COLUMN IF NOT EXISTS install_county text;
ALTER TABLE public.safaricom_registrations ADD COLUMN IF NOT EXISTS install_town text;

CREATE TABLE IF NOT EXISTS public.agent_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id),
  amount_ksh numeric,
  reference text,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id),
  token text,
  device_type text DEFAULT 'android',
  is_active boolean DEFAULT true,
  last_used_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS token text;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS last_used_at timestamptz DEFAULT now();
ALTER TABLE public.device_tokens ADD COLUMN IF NOT EXISTS device_type text DEFAULT 'android';

GRANT EXECUTE ON FUNCTION public.admin_reverse_agent_payment(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reverse_agent_payment(uuid) TO authenticated;

-- Synthetic seed for Phase 1A.1 RPC smoke tests (idempotent)
INSERT INTO public.agents (id, name, email, airtel_phone, town, status, total_earnings, available_balance)
VALUES ('f700b74d-ac1e-4033-85d0-840df1087698', 'Kiambu Bonface', 'bonface@test.local', '254711000099', 'Kiambu', 'approved', 0, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.agent_dispatch_settings (agent_id, is_available, county)
VALUES ('f700b74d-ac1e-4033-85d0-840df1087698', true, 'Kiambu')
ON CONFLICT (agent_id) DO NOTHING;

INSERT INTO public.agents (id, name, email, airtel_phone, town, status, total_earnings, available_balance)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Agent', 'agent@test.local', '254711000001', 'Nairobi', 'approved', 1000, 200)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.agent_dispatch_settings (agent_id, is_available, county)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, 'Nairobi')
ON CONFLICT (agent_id) DO NOTHING;

INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, email, county, installation_town, status, source, product,
  assigned_agent_id, national_id, dedupe_phone_key, commission_earned_ksh, airtel_sr_number
) VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Jane Customer', '254722000002', 'jane@test.local',
  'Nairobi', 'Nairobi', 'assigned', 'airtel5grouter', 'airtel',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12345678', 'dedupe-jane', 500, 'SR-TEST-001'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.customer_registrations (
  id, agent_id, inbound_lead_id, customer_name, airtel_number, alternate_number, email,
  preferred_package, installation_town, delivery_landmark, installation_location, status,
  commission_exempt, created_at
) VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Jane Customer', '254722000002', '254733000003',
  'jane@test.local', 'standard', 'Nairobi', 'Near mall', 'CBD', 'pending',
  true, '2026-08-28T10:00:00.000Z'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.agents (id, name, email, airtel_phone, town, status, total_earnings, available_balance)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Agent Two', 'agent2@test.local', '254711000002', 'Nairobi', 'approved', 500, 100)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.customer_registrations (
  id, agent_id, customer_name, airtel_number, alternate_number, email,
  preferred_package, installation_town, status, commission_exempt, created_at
) VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Self Customer', '254744000004', '254755000005', 'self@test.local',
  'standard', 'Nairobi', 'installed', false, '2026-08-28T12:00:00.000Z'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.safaricom_registrations (id, agent_id, status, created_at)
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'pending', '2026-08-28T14:00:00.000Z')
ON CONFLICT (id) DO NOTHING;

-- Phase 1A.2a recommendation fixture: unassigned lead + agents at varied distances (Nairobi CBD reference)
INSERT INTO public.agents (
  id, name, email, airtel_phone, town, area, status, lead_dispatch_scope,
  working_place, is_fallback_agent, total_earnings, available_balance
) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Near Agent', 'near@test.local', '254711000010', 'Nairobi', 'CBD',
   'approved', 'both',
   '{"placeId":"p-near","name":"CBD Office","lat":-1.2921,"lng":36.8219}'::jsonb,
   false, 800, 100),
  ('22222222-2222-2222-2222-222222222222', 'Mid Agent', 'mid@test.local', '254711000020', 'Nairobi', 'Westlands',
   'approved', 'both',
   '{"placeId":"p-mid","name":"Westlands","lat":-1.2650,"lng":36.8065}'::jsonb,
   false, 600, 80),
  ('33333333-3333-3333-3333-333333333333', 'Far Agent', 'far@test.local', '254711000030', 'Nakuru', 'Nakuru',
   'approved', 'both',
   '{"placeId":"p-far","name":"Nakuru Town","lat":-0.3031,"lng":36.0800}'::jsonb,
   false, 1200, 200),
  ('44444444-4444-4444-4444-444444444444', 'Busy Near', 'busy@test.local', '254711000040', 'Nairobi', 'CBD',
   'approved', 'both',
   '{"placeId":"p-busy","name":"CBD Busy","lat":-1.2930,"lng":36.8225}'::jsonb,
   false, 900, 50),
  ('55555555-5555-5555-5555-555555555555', 'Unapproved', 'bad@test.local', '254711000050', 'Nairobi', 'CBD',
   'pending', 'both',
   '{"placeId":"p-bad","name":"Pending","lat":-1.2921,"lng":36.8219}'::jsonb,
   false, 0, 0),
  ('66666666-6666-6666-6666-666666666666', 'No Pin Agent', 'nopin@test.local', '254711000060', 'Nairobi', NULL,
   'approved', 'both', NULL, false, 400, 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.agent_dispatch_settings (agent_id, is_available, county, last_seen_at, service_radius_km)
VALUES
  ('11111111-1111-1111-1111-111111111111', true, 'Nairobi', now() - interval '2 minutes', NULL),
  ('22222222-2222-2222-2222-222222222222', true, 'Nairobi', now() - interval '30 minutes', NULL),
  ('33333333-3333-3333-3333-333333333333', true, 'Nakuru', now() - interval '1 minute', NULL),
  ('44444444-4444-4444-4444-444444444444', true, 'Nairobi', now() - interval '1 minute', NULL),
  ('66666666-6666-6666-6666-666666666666', true, 'Nairobi', now() - interval '1 minute', NULL)
ON CONFLICT (agent_id) DO NOTHING;

INSERT INTO public.inbound_leads (
  id, created_at, customer_name, primary_phone, email, county, installation_town, status, source, product,
  dedupe_phone_key, metadata
) VALUES (
  '77777777-7777-7777-7777-777777777777',
  now() - interval '30 hours',
  'Queue Customer', '254799000001', 'queue@test.local', 'Nairobi', 'Nairobi',
  'admin_queue', 'airtel5grouter', 'airtel', 'dedupe-queue',
  '{"googlePlace":{"placeId":"p-lead","name":"Customer Pin","formattedAddress":"Nairobi","lat":-1.2921,"lng":36.8219}}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Overloaded near agent with max open leads when cap enabled (cap disabled in fixture dispatch_config)
INSERT INTO public.inbound_leads (
  id, created_at, customer_name, primary_phone, status, source, product, county, installation_town,
  assigned_agent_id, dedupe_phone_key, accepted_at
) SELECT
  '88888888-8888-8888-8888-888888888888', now(), 'Busy Load', '254799000002', 'assigned', 'airtel5grouter', 'airtel',
  'Nairobi', 'Nairobi', '44444444-4444-4444-4444-444444444444', 'dedupe-busy', now()
WHERE NOT EXISTS (SELECT 1 FROM public.inbound_leads WHERE id = '88888888-8888-8888-8888-888888888888');

-- Phase 1A.3 agent action fixtures
INSERT INTO public.agents (id, name, email, airtel_phone, town, status, lead_dispatch_scope, total_earnings, available_balance)
VALUES
  ('99999999-9999-9999-9999-999999999999', 'Banned Agent', 'banned@test.local', '254711000099', 'Nairobi', 'banned', 'none', 0, 0),
  ('aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Rejected Agent', 'rejected@test.local', '254711000098', 'Nairobi', 'rejected', 'none', 0, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, source, product, county, installation_town,
  assigned_agent_id, dedupe_phone_key
) VALUES (
  '99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Install Lead', '254799000099', 'pending_install',
  'airtel5grouter', 'airtel', 'Nairobi', 'Nairobi',
  '11111111-1111-1111-1111-111111111111', 'dedupe-install'
) ON CONFLICT (id) DO NOTHING;

-- Phase 1A.3 remediation fixtures: installed (revert), offered+active offer, assigned (terminal), rejected (forbidden revert), commission-present assigned
INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, source, product, county, installation_town,
  assigned_agent_id, dedupe_phone_key, commission_earned_ksh, installed_at
) VALUES (
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'Installed Lead', '254799000101', 'installed',
  'airtel5grouter', 'airtel', 'Nairobi', 'Nairobi',
  '11111111-1111-1111-1111-111111111111', 'dedupe-installed', 200, now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, source, product, county, installation_town,
  assigned_agent_id, dedupe_phone_key
) VALUES (
  'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'Offered Lead', '254799000102', 'offered',
  'airtel5grouter', 'airtel', 'Nairobi', 'Nairobi',
  '11111111-1111-1111-1111-111111111111', 'dedupe-offered'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lead_offers (id, lead_id, agent_id, status, offer_sequence, expires_at)
SELECT 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
  '11111111-1111-1111-1111-111111111111', 'offered', 1, now() + interval '1 day'
WHERE NOT EXISTS (SELECT 1 FROM public.lead_offers WHERE id = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3');

INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, source, product, county, installation_town,
  assigned_agent_id, dedupe_phone_key
) VALUES (
  'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4', 'Assigned Terminal', '254799000103', 'assigned',
  'airtel5grouter', 'airtel', 'Nairobi', 'Nairobi',
  '11111111-1111-1111-1111-111111111111', 'dedupe-assigned-term'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, source, product, county, installation_town,
  assigned_agent_id, dedupe_phone_key, commission_earned_ksh
) VALUES (
  'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', 'Rejected Lead', '254799000104', 'rejected',
  'airtel5grouter', 'airtel', 'Nairobi', 'Nairobi',
  '11111111-1111-1111-1111-111111111111', 'dedupe-rejected', NULL
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, source, product, county, installation_town,
  assigned_agent_id, dedupe_phone_key, commission_earned_ksh
) VALUES (
  'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6', 'Commission Assigned', '254799000105', 'assigned',
  'airtel5grouter', 'airtel', 'Nairobi', 'Nairobi',
  '11111111-1111-1111-1111-111111111111', 'dedupe-comm-assigned', 150
) ON CONFLICT (id) DO NOTHING;

-- Minimal trigger implementations for disposable side-effect checks
CREATE OR REPLACE FUNCTION public.create_account_status_notification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (agent_id, type, title, message, metadata, created_at)
    VALUES (NEW.id, 'ACCOUNT_STATUS_CHANGE', 'Account status', format('Status: %s', NEW.status),
      jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status),
      clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_account_status_notification ON public.agents;
CREATE TRIGGER trigger_account_status_notification
  AFTER UPDATE OF status ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.create_account_status_notification();

CREATE OR REPLACE FUNCTION public.create_registration_status_notification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.agent_id IS NOT NULL THEN
    INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata, created_at)
    VALUES (
      NEW.agent_id, 'REGISTRATION_STATUS_CHANGE', 'Registration status',
      format('Registration status: %s', NEW.status), NEW.id,
      jsonb_build_object('status', NEW.status, 'previousStatus', OLD.status),
      clock_timestamp()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_registration_status_notification ON public.customer_registrations;
CREATE TRIGGER trigger_registration_status_notification
  AFTER UPDATE OF status ON public.customer_registrations
  FOR EACH ROW EXECUTE FUNCTION public.create_registration_status_notification();

CREATE OR REPLACE FUNCTION public.agents_clear_dispatch_availability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'approved' OR coalesce(NEW.lead_dispatch_scope, 'none') = 'none' THEN
    UPDATE public.agent_dispatch_settings SET is_available = false, updated_at = now()
    WHERE agent_id = NEW.id AND is_available = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agents_clear_dispatch_availability ON public.agents;
CREATE TRIGGER trg_agents_clear_dispatch_availability
  AFTER UPDATE OF status, lead_dispatch_scope ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.agents_clear_dispatch_availability();

CREATE OR REPLACE FUNCTION public.update_agent_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'installed' AND OLD.status IS DISTINCT FROM 'installed' THEN
    UPDATE public.agents SET total_earnings = total_earnings + 500, available_balance = available_balance + 500
    WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_agent_balance_on_update ON public.customer_registrations;
CREATE TRIGGER update_agent_balance_on_update
  AFTER UPDATE OF status ON public.customer_registrations
  FOR EACH ROW EXECUTE FUNCTION public.update_agent_balance();

-- Phase 1A.7 reconciliation + lifecycle fixtures (idempotent)
-- Installed Airtel registration (primary business "installed" bucket)
INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, alternate_phone, status, product, source, assigned_agent_id
) VALUES (
  'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7', 'Reconcile Airtel Lead', '254711100001', NULL,
  'assigned', 'airtel', 'airtel5grouter', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
) ON CONFLICT (id) DO UPDATE SET
  primary_phone = EXCLUDED.primary_phone, status = EXCLUDED.status, installed_at = NULL;

INSERT INTO public.customer_registrations (
  id, agent_id, inbound_lead_id, customer_name, airtel_number, status, created_at
) VALUES (
  'c7c7c7c7-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7', 'Reconcile Airtel Reg', '254711100001', 'installed', now()
) ON CONFLICT (id) DO UPDATE SET
  airtel_number = EXCLUDED.airtel_number, status = EXCLUDED.status, inbound_lead_id = EXCLUDED.inbound_lead_id;

INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, product, source, assigned_agent_id
) VALUES (
  'c8c8c8c8-c8c8-c8c8-c8c8-c8c8c8c8c8c8', 'Reconcile Not Installed', '254711100002',
  'assigned', 'airtel', 'airtel5grouter', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
) ON CONFLICT (id) DO UPDATE SET primary_phone = EXCLUDED.primary_phone, status = EXCLUDED.status;

INSERT INTO public.safaricom_registrations (
  id, agent_id, customer_name, safaricom_number, status, created_at
) VALUES (
  'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Reconcile Safaricom Exact', '254722200001', 'installed', now()
) ON CONFLICT (id) DO UPDATE SET safaricom_number = EXCLUDED.safaricom_number, status = EXCLUDED.status;

-- Lead-only installed (must NOT count in installed_unique_customers)
INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, product, source, installed_at, assigned_agent_id
) VALUES (
  'c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0', 'Lead Only Installed', '254711100080',
  'installed', 'airtel', 'airtel5grouter', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
) ON CONFLICT (id) DO UPDATE SET
  primary_phone = EXCLUDED.primary_phone, status = EXCLUDED.status, installed_at = EXCLUDED.installed_at;

-- Linked lead + registration (one hub identity; not ambiguous)
INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, product, source, assigned_agent_id
) VALUES (
  'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'Linked Lead', '254711100085',
  'assigned', 'airtel', 'airtel5grouter', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
) ON CONFLICT (id) DO UPDATE SET primary_phone = EXCLUDED.primary_phone, status = EXCLUDED.status;

INSERT INTO public.customer_registrations (
  id, agent_id, inbound_lead_id, customer_name, airtel_number, status, created_at
) VALUES (
  'd1d1d1d1-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'Linked Reg', '254711100085', 'pending', now()
) ON CONFLICT (id) DO UPDATE SET
  airtel_number = EXCLUDED.airtel_number, status = EXCLUDED.status, inbound_lead_id = EXCLUDED.inbound_lead_id;

-- Conflicting status: installed lead + non-installed registration linked
INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, product, source, installed_at, assigned_agent_id
) VALUES (
  'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2', 'Conflict Lead', '254711100086',
  'installed', 'airtel', 'airtel5grouter', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
) ON CONFLICT (id) DO UPDATE SET
  primary_phone = EXCLUDED.primary_phone, status = EXCLUDED.status, installed_at = EXCLUDED.installed_at;

INSERT INTO public.customer_registrations (
  id, agent_id, inbound_lead_id, customer_name, airtel_number, status, created_at
) VALUES (
  'e2e2e2e2-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2', 'Conflict Reg', '254711100086', 'pending', now()
) ON CONFLICT (id) DO UPDATE SET
  airtel_number = EXCLUDED.airtel_number, status = EXCLUDED.status, inbound_lead_id = EXCLUDED.inbound_lead_id;

-- Ambiguous: two distinct identities share the same primary MSISDN (not lead_id-linked)
INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, status, product, source, assigned_agent_id
) VALUES
  ('cacacaca-caca-caca-caca-cacacacacaca', 'Ambiguous A', '254711100050', 'assigned', 'airtel', 'airtel5grouter', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'Ambiguous B', '254711100050', 'assigned', 'airtel', 'airtel5grouter', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (id) DO UPDATE SET primary_phone = EXCLUDED.primary_phone, status = EXCLUDED.status;

-- Probable duplicate / ambiguous: MSISDN primary on one identity and alternate on another
INSERT INTO public.inbound_leads (
  id, customer_name, primary_phone, alternate_phone, status, product, source, assigned_agent_id
) VALUES
  ('cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', 'Probable Dup A', '254711100070', NULL, 'assigned', 'airtel', 'airtel5grouter', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('cececece-cece-cece-cece-cececececece', 'Probable Dup B', '254711100071', '254711100070', 'assigned', 'airtel', 'airtel5grouter', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
ON CONFLICT (id) DO UPDATE SET
  primary_phone = EXCLUDED.primary_phone,
  alternate_phone = EXCLUDED.alternate_phone,
  status = EXCLUDED.status;

UPDATE public.agents
SET created_at = timestamptz '2026-01-15 10:00:00+03'
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

INSERT INTO public.notifications (agent_id, type, title, message, created_at)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ACCOUNT_STATUS_CHANGE', 'Approved', 'Agent approved',
  timestamptz '2026-01-16 12:00:00+03'
WHERE NOT EXISTS (
  SELECT 1 FROM public.notifications
  WHERE agent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    AND type = 'ACCOUNT_STATUS_CHANGE'
    AND title = 'Approved'
);
