-- =============================================================================
-- WAM APPS AI Phase 1A.6 — SMS infrastructure (additive)
-- Single-recipient agent SMS ledger + helpers. No provider credentials in SQL.
-- =============================================================================

ALTER TABLE wam_ai.action_events
  ADD COLUMN IF NOT EXISTS sms_ref text;

COMMENT ON COLUMN wam_ai.action_events.sms_ref IS
  'Safe SMS submission reference (S- + 16 hex) when applicable.';

CREATE TABLE IF NOT EXISTS wam_ai.sms_send_intents (
  idempotency_key uuid PRIMARY KEY,
  operation_name text NOT NULL DEFAULT 'send_agent_sms'
    CHECK (operation_name = 'send_agent_sms'),
  correlation_id uuid NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  request_fingerprint text NOT NULL,
  agent_id uuid NOT NULL,
  agent_business_ref text NOT NULL,
  phone_target text NOT NULL CHECK (phone_target IN ('airtel', 'safaricom')),
  destination_fingerprint text NOT NULL,
  masked_destination text NOT NULL,
  message_fingerprint text NOT NULL,
  message_length integer NOT NULL CHECK (message_length BETWEEN 1 AND 640),
  encoding text NOT NULL CHECK (encoding IN ('gsm7_estimate', 'ucs2_estimate')),
  estimated_segments integer NOT NULL CHECK (estimated_segments BETWEEN 1 AND 10),
  status text NOT NULL CHECK (status IN (
    'reserved',
    'provider_accepted',
    'provider_rejected',
    'provider_timeout',
    'provider_ambiguous',
    'cancelled'
  )),
  provider_message_id text,
  sms_ref text,
  notification_id uuid,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sms_send_intents_agent
  ON wam_ai.sms_send_intents (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_send_intents_sms_ref
  ON wam_ai.sms_send_intents (sms_ref)
  WHERE sms_ref IS NOT NULL;

COMMENT ON TABLE wam_ai.sms_send_intents IS
  'Phase 1A.6 SMS submission ledger. Mutable only via SECURITY DEFINER finalize RPCs. No full phone numbers or message bodies.';

ALTER TABLE wam_ai.sms_send_intents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE wam_ai.sms_send_intents FROM PUBLIC, anon, authenticated;
DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    REVOKE ALL ON TABLE wam_ai.sms_send_intents FROM wam_ai_business_readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    REVOKE ALL ON TABLE wam_ai.sms_send_intents FROM wam_ai_business_actions;
  END IF;
END;
$priv$;

CREATE OR REPLACE FUNCTION wam_ai.sms_ref(p_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT 'S-' || left(replace(p_id::text, '-', ''), 16);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.normalize_kenyan_msisdn(p_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_digits text := regexp_replace(coalesce(p_raw, ''), '\D', '', 'g');
BEGIN
  IF v_digits ~ '^0' THEN
    v_digits := '254' || substr(v_digits, 2);
  ELSIF v_digits ~ '^[17]' THEN
    v_digits := '254' || v_digits;
  END IF;
  IF v_digits ~ '^254[17][0-9]{8}$' THEN
    RETURN v_digits;
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.mask_kenyan_msisdn(p_msisdn text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN p_msisdn IS NULL OR length(p_msisdn) < 8 THEN NULL
    ELSE left(p_msisdn, 4) || '****' || right(p_msisdn, 3)
  END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.sms_destination_fingerprint(p_msisdn text)
RETURNS text
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT encode(
    extensions.digest(
      coalesce(p_msisdn, '') || ':' ||
      (SELECT opaque_ref_pepper FROM wam_ai.reporting_config WHERE id = 1),
      'sha256'
    ),
    'hex'
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.sms_message_fingerprint(p_message text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT encode(extensions.digest(coalesce(p_message, ''), 'sha256'), 'hex');
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.sms_action_fingerprint(
  p_agent_id uuid,
  p_phone_target text,
  p_destination_fingerprint text,
  p_message_fingerprint text,
  p_actor_id text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT encode(
    extensions.digest(
      coalesce(p_agent_id::text, '') || ':' ||
      coalesce(p_phone_target, '') || ':' ||
      coalesce(p_destination_fingerprint, '') || ':' ||
      coalesce(p_message_fingerprint, '') || ':' ||
      coalesce(NULLIF(btrim(p_actor_id), ''), ''),
      'sha256'
    ),
    'hex'
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.sms_encoding_estimate(p_message text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN coalesce(p_message, '') ~ '[^\x00-\x7F]' THEN 'ucs2_estimate'
    ELSE 'gsm7_estimate'
  END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.sms_segment_estimate(p_message text)
RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN length(coalesce(p_message, '')) = 0 THEN 0
    WHEN coalesce(p_message, '') ~ '[^\x00-\x7F]' THEN
      greatest(1, ceil(length(p_message)::numeric / 70)::int)
    ELSE
      greatest(1, ceil(length(p_message)::numeric / 160)::int)
  END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._validate_wam_sms_content(p_message text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_msg text := coalesce(p_message, '');
BEGIN
  IF length(btrim(v_msg)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_category', 'validation',
      'message', 'SMS message is required');
  END IF;
  IF length(v_msg) > 640 THEN
    RETURN jsonb_build_object('ok', false, 'error_category', 'validation',
      'message', 'SMS message exceeds 640 characters');
  END IF;
  IF v_msg ~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' THEN
    RETURN jsonb_build_object('ok', false, 'error_category', 'validation',
      'message', 'SMS message contains disallowed control characters');
  END IF;
  IF v_msg ~* '(postgresql://|jdbc:|mongodb://|-----BEGIN |Bearer\s+\S+|sk-[A-Za-z0-9]{10,})' THEN
    RETURN jsonb_build_object('ok', false, 'error_category', 'validation',
      'message', 'SMS message appears to contain secrets or credentials');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'message', v_msg,
    'message_length', length(v_msg),
    'encoding', wam_ai.sms_encoding_estimate(v_msg),
    'estimated_segments', wam_ai.sms_segment_estimate(v_msg),
    'message_fingerprint', wam_ai.sms_message_fingerprint(v_msg)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.sms_ref(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.normalize_kenyan_msisdn(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.mask_kenyan_msisdn(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.sms_destination_fingerprint(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.sms_message_fingerprint(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.sms_action_fingerprint(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.sms_encoding_estimate(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.sms_segment_estimate(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._validate_wam_sms_content(text) FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai' AND p.proname IN (
      'sms_ref', 'normalize_kenyan_msisdn', 'mask_kenyan_msisdn',
      'sms_destination_fingerprint', 'sms_message_fingerprint', 'sms_action_fingerprint',
      'sms_encoding_estimate', 'sms_segment_estimate', '_validate_wam_sms_content'
    )
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_actions', r.sig);
    END IF;
  END LOOP;
END;
$priv$;
