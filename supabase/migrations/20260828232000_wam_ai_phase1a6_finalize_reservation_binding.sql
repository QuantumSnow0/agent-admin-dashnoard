-- =============================================================================
-- WAM APPS AI Phase 1A.6 remediation — finalize reservation binding
-- Requires prepare/finalize correlation_id + actor_id + actor_role exact match
-- to sms_send_intents; audit rows use reservation identity only.
-- Idempotent CREATE OR REPLACE for environments that already applied 231000.
-- =============================================================================
CREATE OR REPLACE FUNCTION wam_ai.finalize_send_agent_sms(
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_provider_outcome text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_provider_error_category text DEFAULT NULL,
  p_provider_error_message text DEFAULT NULL,
  p_record_in_app boolean DEFAULT true,
  p_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_operation constant text := 'send_agent_sms';
  v_intent wam_ai.sms_send_intents%ROWTYPE;
  v_outcome text := lower(coalesce(NULLIF(btrim(p_provider_outcome), ''), ''));
  v_status text;
  v_ok boolean := false;
  v_notification_id uuid;
  v_result jsonb;
  v_content jsonb;
  v_err_cat text := NULLIF(btrim(p_provider_error_category), '');
  v_err_msg text := left(coalesce(NULLIF(btrim(p_provider_error_message), ''), 'SMS provider submission failed'), 300);
  v_provider_msg_id text := left(NULLIF(btrim(p_provider_message_id), ''), 128);
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation', 'message', 'finalize requires idempotency_key, correlation_id, actor_id');
  END IF;

  -- Fail closed before any reservation mutation: only technical_owner may finalize.
  IF NULLIF(btrim(p_actor_role), '') IS NULL
     OR p_actor_role IS DISTINCT FROM 'technical_owner' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'SMS finalize is restricted to technical_owner');
  END IF;

  IF v_outcome NOT IN ('provider_accepted', 'provider_rejected', 'provider_timeout', 'provider_ambiguous') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation', 'message', 'Invalid provider_outcome');
  END IF;

  PERFORM wam_ai._action_idempotency_advisory_lock(v_operation, p_idempotency_key);

  SELECT * INTO v_intent
  FROM wam_ai.sms_send_intents i
  WHERE i.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'not_found', 'message', 'SMS intent reservation not found');
  END IF;

  -- Reservation binding: refuse before any mutation or provider-acceptance claim.
  IF v_intent.actor_role IS DISTINCT FROM 'technical_owner'
     OR p_actor_role IS DISTINCT FROM 'technical_owner' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'SMS finalize reservation is restricted to technical_owner');
  END IF;

  IF v_intent.correlation_id IS DISTINCT FROM p_correlation_id THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'idempotency_conflict',
      'message', 'Finalize correlation_id does not match reservation');
  END IF;

  IF v_intent.actor_id IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'idempotency_conflict',
      'message', 'Finalize actor_id does not match reservation');
  END IF;

  IF v_intent.actor_role IS DISTINCT FROM p_actor_role THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'idempotency_conflict',
      'message', 'Finalize actor_role does not match reservation');
  END IF;

  IF v_intent.status <> 'reserved' THEN
    RETURN v_intent.result_payload || jsonb_build_object(
      'status', CASE WHEN v_intent.status = 'provider_accepted' THEN 'success' ELSE 'error' END,
      'idempotent_replay', true,
      'operation', v_operation,
      'already_completed', true,
      'correlation_id', v_intent.correlation_id);
  END IF;

  v_status := v_outcome;
  v_ok := (v_outcome = 'provider_accepted');
  v_err_cat := CASE
    WHEN v_ok THEN NULL
    ELSE coalesce(v_err_cat, v_outcome)
  END;

  IF v_ok AND coalesce(p_record_in_app, true) THEN
    v_content := wam_ai._validate_wam_sms_content(p_message);
    IF coalesce((v_content->>'ok')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
        'error_category', 'validation',
        'message', 'Cannot record in-app copy: message invalid');
    END IF;
    IF wam_ai.sms_message_fingerprint(v_content->>'message') IS DISTINCT FROM v_intent.message_fingerprint THEN
      RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
        'error_category', 'idempotency_conflict',
        'message', 'Finalize message does not match reservation');
    END IF;

    INSERT INTO public.notifications (
      agent_id, type, title, message, is_read, metadata
    ) VALUES (
      v_intent.agent_id,
      'SYSTEM_ANNOUNCEMENT',
      'SMS from WAM Apps',
      left(v_content->>'message', 500),
      false,
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'wam_ai_mcp',
        'channel', 'sms',
        'kind', 'sms',
        'sms_reference', v_intent.sms_ref,
        'phoneTarget', v_intent.phone_target,
        'maskedDestination', v_intent.masked_destination,
        'providerAccepted', true,
        'deliveryConfirmed', false,
        'correlation_id', v_intent.correlation_id::text
      ))
    ) RETURNING id INTO v_notification_id;
  END IF;

  -- Audit identity always from immutable reservation, never caller-supplied overrides.
  v_result := jsonb_build_object(
    'status', CASE WHEN v_ok THEN 'success' ELSE 'error' END,
    'operation', v_operation,
    'idempotent_replay', false,
    'already_completed', false,
    'changed', v_ok,
    'agent_business_id', v_intent.agent_business_ref,
    'masked_destination', v_intent.masked_destination,
    'phone_target', v_intent.phone_target,
    'sms_reference', v_intent.sms_ref,
    'message_length', v_intent.message_length,
    'encoding', v_intent.encoding,
    'estimated_segments', v_intent.estimated_segments,
    'provider_submission_attempted', true,
    'provider_accepted', v_ok,
    'provider_outcome', v_outcome,
    'provider_message_id', v_provider_msg_id,
    'delivery_confirmed', false,
    'delivery_status', CASE WHEN v_ok THEN 'provider_accepted_only' ELSE v_outcome END,
    'in_app_copy_created', v_notification_id IS NOT NULL,
    'correlation_id', v_intent.correlation_id,
    'error_category', v_err_cat,
    'message', CASE WHEN v_ok THEN 'SMS accepted by provider (not delivery-confirmed)' ELSE v_err_msg END,
    'warnings', jsonb_build_array(
      'delivery_confirmed is false: Agent Hub has no SMS delivery-report webhook.'
    )
  );

  UPDATE wam_ai.sms_send_intents SET
    status = v_status,
    provider_message_id = v_provider_msg_id,
    notification_id = v_notification_id,
    result_payload = v_result,
    error_category = v_err_cat,
    completed_at = now()
  WHERE idempotency_key = p_idempotency_key;

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    agent_business_ref, sms_ref, outcome, error_category
  ) VALUES (
    v_intent.correlation_id, p_idempotency_key, v_intent.actor_id, v_intent.actor_role,
    v_operation, v_intent.agent_business_ref, v_intent.sms_ref,
    CASE WHEN v_ok THEN 'success' ELSE 'failure' END, v_err_cat
  );

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, agent_business_ref, outcome, error_category, result_payload
  ) VALUES (
    p_idempotency_key, v_operation, v_intent.correlation_id, v_intent.actor_id,
    v_intent.actor_role,
    v_intent.request_fingerprint, v_intent.agent_business_ref,
    CASE WHEN v_ok THEN 'success' ELSE 'failure' END, v_err_cat, v_result
  );

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_intent FROM wam_ai.sms_send_intents
    WHERE idempotency_key = p_idempotency_key;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
        'error_category', 'idempotency_conflict',
        'message', 'Concurrent finalize conflict');
    END IF;
    IF v_intent.correlation_id IS DISTINCT FROM p_correlation_id
       OR v_intent.actor_id IS DISTINCT FROM p_actor_id
       OR v_intent.actor_role IS DISTINCT FROM p_actor_role
       OR v_intent.actor_role IS DISTINCT FROM 'technical_owner'
       OR p_actor_role IS DISTINCT FROM 'technical_owner' THEN
      RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
        'error_category', 'idempotency_conflict',
        'message', 'Concurrent finalize conflict with reservation binding mismatch');
    END IF;
    IF v_intent.result_payload IS NOT NULL AND v_intent.result_payload <> '{}'::jsonb THEN
      RETURN v_intent.result_payload || jsonb_build_object(
        'idempotent_replay', true, 'operation', v_operation, 'already_completed', true,
        'correlation_id', v_intent.correlation_id);
    END IF;
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'idempotency_conflict',
      'message', 'Concurrent finalize conflict');
END;
$fn$;

COMMENT ON FUNCTION wam_ai.finalize_send_agent_sms IS
  'MCP: record Onfon submission outcome after reservation binding (correlation/actor/role); audit uses reserved identity; never claims handset delivery.';

REVOKE ALL ON FUNCTION wam_ai.finalize_send_agent_sms(
  uuid, uuid, text, text, text, text, text, text, boolean, text
) FROM PUBLIC, anon, authenticated;
DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    REVOKE ALL ON FUNCTION wam_ai.finalize_send_agent_sms(
      uuid, uuid, text, text, text, text, text, text, boolean, text
    ) FROM wam_ai_business_readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    GRANT EXECUTE ON FUNCTION wam_ai.finalize_send_agent_sms(
      uuid, uuid, text, text, text, text, text, text, boolean, text
    ) TO wam_ai_business_actions;
  END IF;
END;
$priv$;
