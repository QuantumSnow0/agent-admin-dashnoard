-- =============================================================================
-- WAM APPS AI — business_partner authorization remediation (v0.1.22)
-- Extends set_agent_fallback_dispatch, set_agent_service_radius,
-- prepare_send_agent_sms, and finalize_send_agent_sms to allow business_partner
-- alongside technical_owner. Preserves all safety controls, reservation binding,
-- actor/role audit identity, and denies unknown/ai_service/system_maintenance.
-- Forward-only. Do not apply to production without separate authorization.
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai.set_agent_fallback_dispatch(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_is_fallback_agent boolean DEFAULT NULL,
  p_fallback_priority integer DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_agent record;
  v_priority integer;
  v_result jsonb;
  v_operation constant text := 'set_agent_fallback_dispatch';
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation', 'message', 'Required parameters missing');
  END IF;
  IF p_is_fallback_agent IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation', 'message', 'is_fallback_agent (boolean) is required');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'Dispatch configuration requires technical_owner or business_partner');
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', v_operation);
  END IF;

  v_priority := CASE
    WHEN p_fallback_priority IS NULL THEN NULL
    ELSE GREATEST(0, LEAST(9999, round(p_fallback_priority::numeric)::int))
  END;

  v_fingerprint := wam_ai.agent_action_fingerprint(
    v_agent_id, v_operation,
    coalesce(p_is_fallback_agent::text, '') || ':' || coalesce(v_priority::text, ''), p_actor_id);

  PERFORM wam_ai._action_idempotency_advisory_lock(v_operation, p_idempotency_key);

  BEGIN
    SELECT * INTO v_existing
    FROM wam_ai._agent_idempotency_begin(p_idempotency_key, v_operation, v_fingerprint);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'idempotency_conflict');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'idempotent_replay', true, 'operation', v_operation,
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT a.id, a.is_fallback_agent, a.fallback_priority INTO v_agent
  FROM public.agents a WHERE a.id = v_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', v_operation, 'error_category', 'not_found');
  END IF;

  IF v_agent.is_fallback_agent = p_is_fallback_agent
     AND (v_priority IS NULL OR v_agent.fallback_priority = v_priority) THEN
    v_result := jsonb_build_object('status', 'success', 'operation', v_operation, 'already_completed', true,
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'is_fallback_agent', v_agent.is_fallback_agent,
      'fallback_priority', v_agent.fallback_priority,
      'audit_reference', p_correlation_id::text);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, agent_business_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, v_operation, p_correlation_id, p_actor_id, p_actor_role,
      v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);
    RETURN v_result;
  END IF;

  UPDATE public.agents SET
    is_fallback_agent = p_is_fallback_agent,
    fallback_priority = COALESCE(v_priority, fallback_priority)
  WHERE id = v_agent_id;

  SELECT a.is_fallback_agent, a.fallback_priority INTO v_agent
  FROM public.agents a WHERE a.id = v_agent_id;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', v_operation, 'changed', true,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'is_fallback_agent', v_agent.is_fallback_agent,
    'fallback_priority', v_agent.fallback_priority,
    'financial_effect', jsonb_build_object('changed', false),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    agent_business_ref, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, v_operation,
    wam_ai.agent_business_id(v_agent_id), 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, agent_business_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, v_operation, p_correlation_id, p_actor_id, p_actor_role,
    v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.set_agent_service_radius(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_service_radius_km double precision DEFAULT NULL,
  p_clear_radius boolean DEFAULT false,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_radius double precision;
  v_result jsonb;
  v_operation constant text := 'set_agent_service_radius';
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation', 'message', 'Required parameters missing');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'Dispatch configuration requires technical_owner or business_partner');
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', v_operation);
  END IF;

  IF coalesce(p_clear_radius, false) THEN
    v_radius := NULL;
  ELSE
    IF p_service_radius_km IS NULL OR NOT (p_service_radius_km > 0) THEN
      RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
        'error_category', 'validation',
        'message', 'service_radius_km must be between 0.5 and 50, or set clear_radius true');
    END IF;
    v_radius := wam_ai._clamp_service_radius_km(p_service_radius_km);
  END IF;

  v_fingerprint := wam_ai.agent_action_fingerprint(
    v_agent_id, v_operation, coalesce(v_radius::text, 'null'), p_actor_id);

  PERFORM wam_ai._action_idempotency_advisory_lock(v_operation, p_idempotency_key);

  BEGIN
    SELECT * INTO v_existing
    FROM wam_ai._agent_idempotency_begin(p_idempotency_key, v_operation, v_fingerprint);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'idempotency_conflict');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'idempotent_replay', true, 'operation', v_operation,
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.id = v_agent_id) THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', v_operation, 'error_category', 'not_found');
  END IF;

  INSERT INTO public.agent_dispatch_settings (agent_id, service_radius_km, updated_at)
  VALUES (v_agent_id, v_radius, now())
  ON CONFLICT (agent_id) DO UPDATE SET
    service_radius_km = EXCLUDED.service_radius_km,
    updated_at = EXCLUDED.updated_at;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', v_operation, 'changed', true,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'service_radius_km', v_radius,
    'financial_effect', jsonb_build_object('changed', false),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    agent_business_ref, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, v_operation,
    wam_ai.agent_business_id(v_agent_id), 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, agent_business_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, v_operation, p_correlation_id, p_actor_id, p_actor_role,
    v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.prepare_send_agent_sms(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_phone_target text DEFAULT 'airtel',
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_agent_status text DEFAULT NULL,
  p_expected_recipient_business_id text DEFAULT NULL,
  p_expected_destination_fingerprint text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_operation constant text := 'send_agent_sms';
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_content jsonb;
  v_agent record;
  v_raw_phone text;
  v_msisdn text;
  v_dest_fp text;
  v_expected_recipient text := wam_ai.normalize_agent_business_ref(p_expected_recipient_business_id);
  v_expected_dest text := NULLIF(lower(btrim(p_expected_destination_fingerprint)), '');
  v_phone_target text := lower(coalesce(NULLIF(btrim(p_phone_target), ''), 'airtel'));
  v_fingerprint text;
  v_intent wam_ai.sms_send_intents%ROWTYPE;
  v_existing_req wam_ai.action_requests%ROWTYPE;
  v_summary text := left(coalesce(NULLIF(btrim(p_instruction_summary), ''), 'send_agent_sms'), 200);
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation',
      'message', 'idempotency_key, correlation_id, actor_id and actor_role are required');
  END IF;

  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'SMS send is restricted to technical_owner or business_partner');
  END IF;

  IF NULLIF(btrim(p_expected_agent_status), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation', 'message', 'expected_agent_status is required');
  END IF;

  IF NULLIF(btrim(p_expected_recipient_business_id), '') IS NOT NULL AND v_expected_recipient IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation',
      'message', 'Invalid expected_recipient_business_id');
  END IF;

  IF v_expected_dest IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation',
      'message', 'expected_destination_fingerprint is required');
  END IF;

  IF v_phone_target NOT IN ('airtel', 'safaricom') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation',
      'message', 'phone_target must be airtel or safaricom');
  END IF;

  v_content := wam_ai._validate_wam_sms_content(p_message);
  IF coalesce((v_content->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_content || jsonb_build_object('status', 'error', 'operation', v_operation);
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', v_operation);
  END IF;

  SELECT a.id, a.name, a.status, a.airtel_phone, a.safaricom_phone
  INTO v_agent FROM public.agents a WHERE a.id = v_agent_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', v_operation,
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;

  IF v_agent.status IS DISTINCT FROM p_expected_agent_status THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'expected_state_conflict',
      'message', 'Agent status changed since preview',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'previous_agent_status', v_agent.status);
  END IF;

  IF v_expected_recipient IS NOT NULL
     AND wam_ai.agent_business_id(v_agent_id) <> v_expected_recipient THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'expected_state_conflict',
      'message', 'Resolved recipient does not match expected_recipient_business_id',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  v_raw_phone := CASE v_phone_target
    WHEN 'safaricom' THEN v_agent.safaricom_phone
    ELSE v_agent.airtel_phone
  END;
  v_msisdn := wam_ai.normalize_kenyan_msisdn(v_raw_phone);
  IF v_msisdn IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'recipient_unreachable',
      'message', format('No valid %s phone on agent profile', v_phone_target),
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  v_dest_fp := wam_ai.sms_destination_fingerprint(v_msisdn);
  IF v_dest_fp IS DISTINCT FROM v_expected_dest THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'expected_state_conflict',
      'message', 'Destination phone changed since preview',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'masked_destination', wam_ai.mask_kenyan_msisdn(v_msisdn));
  END IF;

  v_fingerprint := wam_ai.sms_action_fingerprint(
    v_agent_id, v_phone_target, v_dest_fp,
    v_content->>'message_fingerprint', p_actor_id);

  PERFORM wam_ai._action_idempotency_advisory_lock(v_operation, p_idempotency_key);

  SELECT * INTO v_existing_req
  FROM wam_ai.action_requests ar
  WHERE ar.idempotency_key = p_idempotency_key
    AND ar.operation_name = v_operation
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_req.request_fingerprint <> v_fingerprint THEN
      RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
        'error_category', 'idempotency_conflict',
        'message', 'Idempotency key reused with different recipient or content');
    END IF;
    RETURN v_existing_req.result_payload || jsonb_build_object(
      'status', CASE WHEN v_existing_req.outcome = 'success' THEN 'success' ELSE 'error' END,
      'idempotent_replay', true,
      'operation', v_operation,
      'already_completed', true,
      'provider_submission_attempted', false);
  END IF;

  SELECT * INTO v_intent
  FROM wam_ai.sms_send_intents i
  WHERE i.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_intent.request_fingerprint <> v_fingerprint THEN
      RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
        'error_category', 'idempotency_conflict',
        'message', 'Idempotency key reused with different recipient or content');
    END IF;
    IF v_intent.status = 'reserved' THEN
      RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
        'error_category', 'submission_in_progress',
        'message', 'An identical SMS submission is already reserved; wait or use a new idempotency key after review');
    END IF;
    RETURN v_intent.result_payload || jsonb_build_object(
      'status', CASE WHEN v_intent.status = 'provider_accepted' THEN 'success' ELSE 'error' END,
      'idempotent_replay', true,
      'operation', v_operation,
      'already_completed', true,
      'provider_submission_attempted', false);
  END IF;

  INSERT INTO wam_ai.sms_send_intents (
    idempotency_key, correlation_id, actor_id, actor_role, request_fingerprint,
    agent_id, agent_business_ref, phone_target, destination_fingerprint,
    masked_destination, message_fingerprint, message_length, encoding,
    estimated_segments, status, sms_ref
  ) VALUES (
    p_idempotency_key, p_correlation_id, p_actor_id, p_actor_role, v_fingerprint,
    v_agent_id, wam_ai.agent_business_id(v_agent_id), v_phone_target, v_dest_fp,
    wam_ai.mask_kenyan_msisdn(v_msisdn), v_content->>'message_fingerprint',
    (v_content->>'message_length')::int, v_content->>'encoding',
    (v_content->>'estimated_segments')::int, 'reserved',
    wam_ai.sms_ref(p_idempotency_key)
  );

  RETURN jsonb_build_object(
    'status', 'ready',
    'operation', v_operation,
    'idempotent_replay', false,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'recipient_display_name', left(coalesce(v_agent.name, 'Agent'), 80),
    'phone_target', v_phone_target,
    'masked_destination', wam_ai.mask_kenyan_msisdn(v_msisdn),
    'destination_fingerprint', v_dest_fp,
    'normalized_destination', v_msisdn,
    'message_length', (v_content->>'message_length')::int,
    'encoding', v_content->>'encoding',
    'estimated_segments', (v_content->>'estimated_segments')::int,
    'sms_reference', wam_ai.sms_ref(p_idempotency_key),
    'instruction_summary', v_summary,
    'correlation_id', p_correlation_id,
    'warnings', jsonb_build_array(
      'Provider acceptance is not handset delivery confirmation.',
      'Onfon has no client idempotency key; do not retry ambiguous timeouts with a new key without checking the provider portal.'
    )
  );
END;
$fn$;

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

  -- Fail closed before any reservation mutation: gateway business roles only.
  IF NULLIF(btrim(p_actor_role), '') IS NULL
     OR p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'SMS finalize is restricted to technical_owner or business_partner');
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
  IF v_intent.actor_role NOT IN ('technical_owner', 'business_partner')
     OR p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'SMS finalize reservation is restricted to technical_owner or business_partner');
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
       OR v_intent.actor_role NOT IN ('technical_owner', 'business_partner')
       OR p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
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

COMMENT ON FUNCTION wam_ai.set_agent_fallback_dispatch(uuid, text, boolean, integer, uuid, uuid, text, text, text) IS
  'MCP: wam.business.agents.set_agent_fallback_dispatch — technical_owner or business_partner; fallback pool configuration.';
COMMENT ON FUNCTION wam_ai.set_agent_service_radius(uuid, text, double precision, boolean, uuid, uuid, text, text, text) IS
  'MCP: wam.business.agents.set_agent_service_radius — technical_owner or business_partner; service radius configuration.';
COMMENT ON FUNCTION wam_ai.prepare_send_agent_sms(uuid, text, text, text, uuid, uuid, text, text, text, text, text, text) IS
  'MCP: wam.business.messaging.send_agent_sms prepare — technical_owner or business_partner; verified Agent Hub recipient only.';
COMMENT ON FUNCTION wam_ai.finalize_send_agent_sms(uuid, uuid, text, text, text, text, text, text, boolean, text) IS
  'MCP: wam.business.messaging.send_agent_sms finalize — technical_owner or business_partner; reservation actor binding preserved.';

