-- =============================================================================
-- WAM APPS AI Phase 1A.4 — send_agent_notification action RPC
-- Creates in-app notification row only. Does NOT invoke Expo push delivery.
-- Remediation: transaction-scoped advisory idempotency lock before any insert.
-- =============================================================================

DROP FUNCTION IF EXISTS wam_ai.send_agent_notification(
  uuid, text, text, text, text, text, uuid, uuid, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION wam_ai.send_agent_notification(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_notification_type text DEFAULT 'SYSTEM_ANNOUNCEMENT',
  p_deep_link text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_agent_status text DEFAULT NULL,
  p_expected_recipient_business_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_content jsonb;
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_agent record;
  v_notification_id uuid;
  v_token_at_creation boolean;
  v_result jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_summary text := left(coalesce(NULLIF(btrim(p_instruction_summary), ''), 'send_agent_notification'), 200);
  v_expected_recipient text := wam_ai.normalize_agent_business_ref(p_expected_recipient_business_id);
  v_operation constant text := 'send_agent_notification';
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation,
      'error_category', 'validation',
      'message', 'idempotency_key, correlation_id, actor_id and actor_role are required');
  END IF;

  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized', 'message', 'Actor role not authorized');
  END IF;

  IF NULLIF(btrim(p_expected_agent_status), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation,
      'error_category', 'validation', 'message', 'expected_agent_status is required');
  END IF;

  IF NULLIF(btrim(p_expected_recipient_business_id), '') IS NOT NULL AND v_expected_recipient IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation,
      'error_category', 'validation',
      'message', 'Invalid expected_recipient_business_id; raw UUID strings are not accepted as safe references');
  END IF;

  v_content := wam_ai._validate_wam_notification_content(
    p_title, p_message, p_notification_type, p_deep_link);
  IF coalesce((v_content->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_content || jsonb_build_object('status', 'error', 'operation', v_operation);
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', v_operation);
  END IF;

  v_fingerprint := wam_ai.notification_action_fingerprint(
    v_agent_id, v_operation,
    v_content->>'title', v_content->>'message', v_content->>'type',
    v_content->>'deep_link', p_actor_id);

  PERFORM wam_ai._action_idempotency_advisory_lock(v_operation, p_idempotency_key);

  BEGIN
    SELECT * INTO v_existing
    FROM wam_ai._agent_idempotency_begin(p_idempotency_key, v_operation, v_fingerprint);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%idempotency_conflict%' OR SQLSTATE = '23505' THEN
      RETURN jsonb_build_object(
        'status', 'error', 'operation', v_operation,
        'error_category', 'idempotency_conflict',
        'message', 'Idempotency key reused with different recipient or content');
    END IF;
    RAISE;
  END;

  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END,
      'idempotent_replay', true,
      'operation', v_operation,
      'already_completed', coalesce((v_existing.result_payload->>'already_completed')::boolean, true));
  END IF;

  SELECT a.id, a.status, a.name INTO v_agent
  FROM public.agents a WHERE a.id = v_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'not_found', 'operation', v_operation,
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;

  IF v_agent.status IS DISTINCT FROM p_expected_agent_status THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation,
      'error_category', 'expected_state_conflict',
      'message', 'Agent status changed since preview',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'previous_agent_status', v_agent.status);
  END IF;

  IF v_expected_recipient IS NOT NULL
     AND wam_ai.agent_business_id(v_agent_id) <> v_expected_recipient THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation,
      'error_category', 'expected_state_conflict',
      'message', 'Resolved recipient does not match expected_recipient_business_id',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  IF v_agent.status IS DISTINCT FROM 'approved' THEN
    v_warnings := v_warnings || jsonb_build_array(
      format('Recipient agent status is %s; admin dashboard may still notify, but operational caution applies.', v_agent.status));
  END IF;

  v_token_at_creation := wam_ai._agent_has_active_device_token(v_agent_id);

  BEGIN
    INSERT INTO public.notifications (
      agent_id, type, title, message, is_read, metadata
    ) VALUES (
      v_agent_id,
      v_content->>'type',
      v_content->>'title',
      v_content->>'message',
      false,
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'wam_ai_mcp',
        'custom', true,
        'kind', 'announcement',
        'deepLink', v_content->>'deep_link',
        'pushAttemptedByCreationRpc', false,
        'deviceTokenAvailableAtCreation', v_token_at_creation
      ))
    )
    RETURNING id INTO v_notification_id;

    v_result := jsonb_build_object(
      'status', 'success',
      'operation', v_operation,
      'idempotent_replay', false,
      'already_completed', false,
      'changed', true,
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'recipient_display_name', left(coalesce(v_agent.name, 'Agent'), 80),
      'notification_reference', wam_ai.notification_ref(v_notification_id),
      'notification_record_created', true,
      'in_app_created', true,
      'notification_type', v_content->>'type',
      'created_at', (SELECT n.created_at FROM public.notifications n WHERE n.id = v_notification_id),
      'push_attempted_by_rpc', false,
      'push_delivery_from_rpc', 'not_sent',
      'provider_accepted', false,
      'delivery_confirmed', false,
      'delivery_status', 'unknown',
      'current_device_token_available', v_token_at_creation,
      'device_token_available_at_creation', v_token_at_creation,
      'action_reference', p_correlation_id::text,
      'correlation_id', p_correlation_id::text,
      'instruction_summary', v_summary,
      'warnings', v_warnings || jsonb_build_array(
        'This RPC creates an in-app row only; external push delivery is not attempted or guaranteed.'
      )
    );

    INSERT INTO wam_ai.action_events (
      correlation_id, idempotency_key, actor_id, actor_role, operation_name,
      agent_business_ref, notification_ref, previous_agent_status, resulting_agent_status, outcome
    ) VALUES (
      p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, v_operation,
      wam_ai.agent_business_id(v_agent_id), wam_ai.notification_ref(v_notification_id),
      v_agent.status, v_agent.status, 'success');

    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, agent_business_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, v_operation, p_correlation_id, p_actor_id, p_actor_role,
      v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);

    RETURN v_result;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT ar.* INTO v_existing
      FROM wam_ai.action_requests ar
      WHERE ar.idempotency_key = p_idempotency_key
        AND ar.operation_name = v_operation
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE;
      END IF;

      IF v_existing.request_fingerprint <> v_fingerprint THEN
        RETURN jsonb_build_object(
          'status', 'error', 'operation', v_operation,
          'error_category', 'idempotency_conflict',
          'message', 'Concurrent idempotency conflict with different content');
      END IF;

      RETURN v_existing.result_payload || jsonb_build_object(
        'status', 'success',
        'idempotent_replay', true,
        'operation', v_operation,
        'already_completed', true);
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.send_agent_notification(
  uuid, text, text, text, text, text, uuid, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    REVOKE ALL ON FUNCTION wam_ai.send_agent_notification(
      uuid, text, text, text, text, text, uuid, uuid, text, text, text, text, text
    ) FROM wam_ai_business_readonly;
  END IF;
END;
$priv$;

COMMENT ON FUNCTION wam_ai.send_agent_notification IS
  'MCP: wam.business.notifications.send_agent_notification — inserts one in-app notification; does not send push.';

-- GRANT EXECUTE ON FUNCTION wam_ai.send_agent_notification(...) TO wam_ai_business_actions;
