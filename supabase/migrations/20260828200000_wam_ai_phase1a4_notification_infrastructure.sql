-- =============================================================================
-- WAM APPS AI Phase 1A.4 — notification action infrastructure (additive)
-- Remediation: advisory idempotency lock, honest delivery evidence, safe refs.
-- =============================================================================

ALTER TABLE wam_ai.action_events
  ADD COLUMN IF NOT EXISTS notification_ref text;

COMMENT ON COLUMN wam_ai.action_events.notification_ref IS
  'Safe external notification reference for WAM notification actions.';

CREATE OR REPLACE FUNCTION wam_ai.notification_ref(p_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT 'N-' || left(replace(p_id::text, '-', ''), 16);
$fn$;

COMMENT ON FUNCTION wam_ai.notification_ref IS
  'Safe external notification reference for MCP responses and audit (16 hex chars).';

CREATE OR REPLACE FUNCTION wam_ai._resolve_notification_id_by_ref(
  p_notification_reference text,
  OUT v_notification_id uuid,
  OUT v_error jsonb
)
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_ref text := NULLIF(upper(btrim(p_notification_reference)), '');
  v_count integer;
BEGIN
  v_notification_id := NULL;
  IF v_ref IS NULL THEN
    v_error := jsonb_build_object(
      'status', 'error', 'error_category', 'validation',
      'message', 'notification_reference is required');
    RETURN;
  END IF;

  IF v_ref ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' THEN
    v_error := jsonb_build_object(
      'status', 'error', 'error_category', 'validation',
      'message', 'Raw notification UUID is not accepted; use safe notification_reference');
    RETURN;
  END IF;

  IF NOT v_ref ~ '^N-[0-9A-F]{16}$' THEN
    v_error := jsonb_build_object(
      'status', 'error', 'error_category', 'validation',
      'message', 'notification_reference must match N- followed by 16 hex characters');
    RETURN;
  END IF;

  SELECT count(*)::int INTO v_count
  FROM public.notifications n
  WHERE upper(wam_ai.notification_ref(n.id)) = v_ref;

  IF v_count = 0 THEN
    v_error := jsonb_build_object(
      'status', 'not_found', 'error_category', 'not_found',
      'message', 'Notification not found');
    RETURN;
  END IF;

  IF v_count > 1 THEN
    v_error := jsonb_build_object(
      'status', 'ambiguous', 'error_category', 'ambiguous_match',
      'message', 'notification_reference matches multiple notifications',
      'match_count', v_count);
    RETURN;
  END IF;

  SELECT n.id INTO v_notification_id
  FROM public.notifications n
  WHERE upper(wam_ai.notification_ref(n.id)) = v_ref;

  v_error := NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._action_idempotency_advisory_lock(
  p_operation_name text,
  p_idempotency_key uuid
) RETURNS void
LANGUAGE plpgsql
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
BEGIN
  IF p_idempotency_key IS NULL OR NULLIF(btrim(p_operation_name), '') IS NULL THEN
    RAISE EXCEPTION 'idempotency_lock_requires_operation_and_key' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      coalesce(NULLIF(btrim(p_operation_name), ''), '') || ':' || p_idempotency_key::text,
      0
    )
  );
END;
$fn$;

DROP FUNCTION IF EXISTS wam_ai.notification_action_fingerprint(uuid, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS wam_ai._validate_wam_notification_content(text, text, text, text);

CREATE OR REPLACE FUNCTION wam_ai.notification_action_fingerprint(
  p_agent_id uuid,
  p_operation text,
  p_title text,
  p_message text,
  p_notification_type text,
  p_deep_link text,
  p_actor_id text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT encode(
    extensions.digest(
      coalesce(p_agent_id::text, '') || ':' ||
      coalesce(NULLIF(btrim(p_operation), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_title), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_message), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_notification_type), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_deep_link), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_actor_id), ''), ''),
      'sha256'
    ),
    'hex'
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._agent_has_active_device_token(p_agent_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.device_tokens dt
    WHERE dt.agent_id = p_agent_id
      AND coalesce(dt.is_active, true) = true
      AND NULLIF(btrim(dt.token), '') IS NOT NULL
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._notification_historical_delivery_evidence(p_notification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_metadata jsonb;
  v_receipt_at timestamptz;
  v_wam_created boolean;
  v_rpc_attempted boolean;
  v_token_at_creation boolean;
BEGIN
  SELECT n.agent_id, coalesce(n.metadata, '{}'::jsonb)
  INTO v_agent_id, v_metadata
  FROM public.notifications n
  WHERE n.id = p_notification_id;

  IF v_agent_id IS NULL THEN
    RETURN jsonb_build_object(
      'delivery_status', 'unknown',
      'provider_accepted', false,
      'push_attempted', NULL,
      'delivery_confirmed', false,
      'current_device_token_available', NULL
    );
  END IF;

  v_wam_created := lower(coalesce(v_metadata->>'source', '')) = 'wam_ai_mcp';
  IF v_wam_created AND v_metadata ? 'pushAttemptedByCreationRpc' THEN
    v_rpc_attempted := (v_metadata->>'pushAttemptedByCreationRpc')::boolean;
  ELSE
    v_rpc_attempted := NULL;
  END IF;
  IF v_wam_created AND v_metadata ? 'deviceTokenAvailableAtCreation' THEN
    v_token_at_creation := (v_metadata->>'deviceTokenAvailableAtCreation')::boolean;
  ELSE
    v_token_at_creation := NULL;
  END IF;

  SELECT r.sent_at INTO v_receipt_at
  FROM public.notification_push_receipts r
  WHERE r.notification_id = p_notification_id;

  IF v_receipt_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'delivery_status', 'provider_accepted',
      'provider_accepted', true,
      'push_attempted', true,
      'delivery_confirmed', false,
      'push_receipt_at', v_receipt_at,
      'push_attempted_by_creation_rpc', to_jsonb(v_rpc_attempted),
      'device_token_available_at_creation', to_jsonb(v_token_at_creation),
      'current_device_token_available', wam_ai._agent_has_active_device_token(v_agent_id),
      'warnings', jsonb_build_array(
        'Receipt records Expo ticket acceptance only; device delivery is not confirmed in Agent Hub.'
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'delivery_status', 'unknown',
    'provider_accepted', false,
    'push_attempted', NULL,
    'delivery_confirmed', false,
    'push_receipt_at', NULL,
    'push_attempted_by_creation_rpc', to_jsonb(v_rpc_attempted),
    'device_token_available_at_creation', to_jsonb(v_token_at_creation),
    'current_device_token_available', wam_ai._agent_has_active_device_token(v_agent_id),
    'warnings', jsonb_build_array(
      'External push attempt/delivery cannot be determined without a provider receipt.'
    )
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._validate_wam_notification_content(
  p_title text,
  p_message text,
  p_notification_type text,
  p_deep_link text
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_title text := NULLIF(btrim(p_title), '');
  v_message text := NULLIF(btrim(p_message), '');
  v_type text := upper(NULLIF(btrim(p_notification_type), ''));
  v_deep text := NULLIF(lower(btrim(p_deep_link)), '');
BEGIN
  IF v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_category', 'validation', 'message', 'title is required');
  END IF;
  IF char_length(v_title) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'error_category', 'validation', 'message', 'title exceeds 200 characters');
  END IF;
  IF v_message IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_category', 'validation', 'message', 'message is required');
  END IF;
  IF char_length(v_message) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error_category', 'validation', 'message', 'message exceeds 2000 characters');
  END IF;
  IF v_type IS NULL OR v_type <> 'SYSTEM_ANNOUNCEMENT' THEN
    RETURN jsonb_build_object(
      'ok', false, 'error_category', 'validation',
      'message', 'Only SYSTEM_ANNOUNCEMENT is permitted for WAM custom notifications');
  END IF;

  IF v_title ~* '(postgresql://|jdbc:|mongodb://|-----BEGIN |Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{10,})'
     OR v_message ~* '(postgresql://|jdbc:|mongodb://|-----BEGIN |Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{10,})' THEN
    RETURN jsonb_build_object('ok', false, 'error_category', 'validation', 'message', 'Notification content rejected');
  END IF;

  IF v_deep IS NOT NULL AND v_deep NOT IN ('dashboard') THEN
    RETURN jsonb_build_object(
      'ok', false, 'error_category', 'validation',
      'message', 'deep_link must be a supported in-app route (dashboard) or omitted');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'title', v_title,
    'message', v_message,
    'type', v_type,
    'deep_link', v_deep
  );
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.notification_ref(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._resolve_notification_id_by_ref(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._action_idempotency_advisory_lock(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.notification_action_fingerprint(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._agent_has_active_device_token(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._notification_historical_delivery_evidence(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._validate_wam_notification_content(text, text, text, text) FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN (
        'notification_ref',
        '_resolve_notification_id_by_ref',
        '_action_idempotency_advisory_lock',
        'notification_action_fingerprint',
        '_agent_has_active_device_token',
        '_notification_historical_delivery_evidence',
        '_validate_wam_notification_content',
        '_notification_delivery_snapshot'
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

DROP FUNCTION IF EXISTS wam_ai._notification_delivery_snapshot(uuid);
