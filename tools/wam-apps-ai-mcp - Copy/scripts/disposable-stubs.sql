-- Minimal stubs so hardening REVOKE can run on a disposable DB.
CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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
  id int PRIMARY KEY, offer_timeout_minutes int, sla_hours int
);
INSERT INTO public.dispatch_config VALUES (1, 10, 24) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.inbound_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz,
  status text,
  source text,
  product text,
  county text,
  installation_town text,
  assigned_agent_id uuid,
  call_initiated_at timestamptz,
  kyc_started_at timestamptz,
  accepted_at timestamptz,
  kyc_completed_at timestamptz,
  callback_at timestamptz,
  installed_at timestamptz,
  commission_earned_ksh numeric,
  dedupe_phone_key text
);

CREATE TABLE IF NOT EXISTS public.lead_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  agent_id uuid,
  status text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  responded_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  status text,
  lead_dispatch_scope text,
  available_balance numeric
);

CREATE TABLE IF NOT EXISTS public.customer_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz,
  status text
);

CREATE TABLE IF NOT EXISTS public.safaricom_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz,
  status text
);

CREATE TABLE IF NOT EXISTS public.agent_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid,
  amount_ksh numeric,
  created_at timestamptz DEFAULT now()
);

GRANT EXECUTE ON FUNCTION public.admin_reverse_agent_payment(uuid) TO PUBLIC;
