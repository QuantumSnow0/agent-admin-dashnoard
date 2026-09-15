-- =============================================================================
-- WAM APPS AI Phase 1A.4 — read-only notification inspection RPCs
-- Remediation: honest historical delivery evidence; fail-closed ref resolution.
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai.get_agent_notification_history(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_since timestamptz := coalesce(p_since, now() - interval '30 days');
  v_until timestamptz := coalesce(p_until, now());
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_rows jsonb;
BEGIN
  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', 'get_agent_notification_history');
  END IF;

  IF v_since > v_until THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', 'get_agent_notification_history',
      'error_category', 'validation', 'message', 'since must be before until');
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      wam_ai.notification_ref(n.id) AS notification_reference,
      wam_ai.agent_business_id(n.agent_id) AS recipient_business_id,
      n.type AS notification_type,
      n.title,
      left(n.message, 500) AS message,
      n.created_at,
      n.is_read AS is_read,
      n.read_at,
      (wam_ai._notification_historical_delivery_evidence(n.id)->>'delivery_status') AS delivery_status,
      coalesce((wam_ai._notification_historical_delivery_evidence(n.id)->>'provider_accepted')::boolean, false)
        AS provider_accepted,
      wam_ai._notification_historical_delivery_evidence(n.id)->'push_attempted' AS push_attempted,
      coalesce(
        (wam_ai._notification_historical_delivery_evidence(n.id)->>'current_device_token_available')::boolean,
        false
      ) AS current_device_token_available,
      wam_ai._notification_historical_delivery_evidence(n.id)->'device_token_available_at_creation'
        AS device_token_available_at_creation,
      CASE
        WHEN lower(coalesce(n.metadata->>'source', '')) = 'wam_ai_mcp' THEN false
        ELSE NULL
      END AS push_attempted_by_creation_rpc
    FROM public.notifications n
    WHERE n.agent_id = v_agent_id
      AND n.created_at >= v_since
      AND n.created_at <= v_until
    ORDER BY n.created_at DESC
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'get_agent_notification_history',
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'since', v_since,
    'until', v_until,
    'limit', v_limit,
    'result_count', jsonb_array_length(v_rows),
    'notifications', v_rows,
    'warnings', CASE
      WHEN jsonb_array_length(v_rows) = 0 THEN jsonb_build_array('No notifications in range.')
      ELSE jsonb_build_array(
        'Historical push_attempted is unknown without a provider receipt; current_device_token_available is a live snapshot only.'
      )
    END
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_notification_delivery_status(
  p_notification_reference text,
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_notification_id uuid;
  v_ref_err jsonb;
  v_evidence jsonb;
  v_row record;
  v_wam_created boolean;
BEGIN
  SELECT t.v_notification_id, t.v_error
  INTO v_notification_id, v_ref_err
  FROM wam_ai._resolve_notification_id_by_ref(p_notification_reference) t;

  IF v_ref_err IS NOT NULL THEN
    RETURN v_ref_err || jsonb_build_object('operation', 'get_notification_delivery_status');
  END IF;

  SELECT n.id, n.agent_id, n.type, n.created_at, n.title, coalesce(n.metadata, '{}'::jsonb) AS metadata
  INTO v_row
  FROM public.notifications n
  WHERE n.id = v_notification_id;

  IF p_agent_id IS NOT NULL OR NULLIF(btrim(p_agent_business_id), '') IS NOT NULL THEN
    SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
    FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
    IF v_resolve_err IS NOT NULL THEN
      RETURN v_resolve_err || jsonb_build_object('operation', 'get_notification_delivery_status');
    END IF;
    IF v_row.agent_id IS DISTINCT FROM v_agent_id THEN
      RETURN jsonb_build_object(
        'status', 'not_found', 'operation', 'get_notification_delivery_status',
        'error_category', 'not_found', 'message', 'Notification not found for verified agent');
    END IF;
  END IF;

  v_evidence := wam_ai._notification_historical_delivery_evidence(v_notification_id);
  v_wam_created := lower(coalesce(v_row.metadata->>'source', '')) = 'wam_ai_mcp';

  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'get_notification_delivery_status',
    'notification_reference', wam_ai.notification_ref(v_notification_id),
    'recipient_business_id', wam_ai.agent_business_id(v_row.agent_id),
    'notification_type', v_row.type,
    'created_at', v_row.created_at,
    'title', left(v_row.title, 200),
    'in_app_created', true,
    'provider_accepted', coalesce((v_evidence->>'provider_accepted')::boolean, false),
    'push_attempted', v_evidence->'push_attempted',
    'delivery_confirmed', false,
    'delivery_status', v_evidence->>'delivery_status',
    'current_device_token_available', v_evidence->'current_device_token_available',
    'device_token_available_at_creation', v_evidence->'device_token_available_at_creation',
    'push_attempted_by_creation_rpc', CASE
      WHEN v_wam_created THEN to_jsonb(false)
      ELSE NULL
    END,
    'push_receipt_at', v_evidence->'push_receipt_at',
    'warnings', coalesce(v_evidence->'warnings', '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.get_agent_notification_history(uuid, text, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.get_notification_delivery_status(text, uuid, text)
  FROM PUBLIC, anon, authenticated;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    REVOKE ALL ON FUNCTION wam_ai.get_agent_notification_history(uuid, text, timestamptz, timestamptz, integer)
      FROM wam_ai_business_actions;
    REVOKE ALL ON FUNCTION wam_ai.get_notification_delivery_status(text, uuid, text)
      FROM wam_ai_business_actions;
  END IF;
END;
$priv$;

COMMENT ON FUNCTION wam_ai.get_agent_notification_history IS
  'MCP: wam.business.notifications.get_agent_notification_history';
COMMENT ON FUNCTION wam_ai.get_notification_delivery_status IS
  'MCP: wam.business.notifications.get_notification_delivery_status';

-- GRANT EXECUTE ON FUNCTION wam_ai.get_agent_notification_history(...) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_notification_delivery_status(...) TO wam_ai_business_readonly;
