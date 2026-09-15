-- =============================================================================
-- WAM APPS AI Phase 1A.6 — SMS action + read RPCs
-- prepare_send_agent_sms / finalize_send_agent_sms + history/status reads.
-- Provider HTTP call happens in MCP only — never from SQL.
-- =============================================================================

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

  IF p_actor_role IS DISTINCT FROM 'technical_owner' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'SMS send is restricted to technical_owner');
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

CREATE OR REPLACE FUNCTION wam_ai.get_agent_sms_history(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL,
  p_limit integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_err jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_since timestamptz := coalesce(p_since, now() - interval '30 days');
  v_until timestamptz := coalesce(p_until, now());
  v_rows jsonb;
BEGIN
  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_err IS NOT NULL THEN
    RETURN v_err || jsonb_build_object('operation', 'get_agent_sms_history');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      n.id AS notification_id,
      wam_ai.sms_ref(n.id) AS history_row_ref,
      n.created_at,
      n.title,
      left(n.message, 120) AS message_preview,
      n.metadata->>'sms_reference' AS sms_reference,
      n.metadata->>'phoneTarget' AS phone_target,
      n.metadata->>'maskedDestination' AS masked_destination,
      coalesce((n.metadata->>'providerAccepted')::boolean, false) AS provider_accepted,
      false AS delivery_confirmed,
      'unknown_without_dlr' AS delivery_status,
      'in_app_sms_copy' AS evidence_source
    FROM public.notifications n
    WHERE n.agent_id = v_agent_id
      AND coalesce(n.metadata->>'channel', '') = 'sms'
      AND n.created_at >= v_since
      AND n.created_at <= v_until
    ORDER BY n.created_at DESC
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'get_agent_sms_history',
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'result_count', jsonb_array_length(v_rows),
    'messages', v_rows,
    'caveats', jsonb_build_array(
      'History reflects in-app SMS copies and ledger-backed submissions only.',
      'Handset delivery is not confirmed without a delivery-report webhook.'
    )
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_sms_delivery_status(
  p_sms_reference text DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_ref text := NULLIF(btrim(p_sms_reference), '');
  v_intent wam_ai.sms_send_intents%ROWTYPE;
  v_agent_id uuid;
  v_err jsonb;
BEGIN
  IF v_ref IS NULL OR upper(v_ref) !~ '^S-[0-9A-F]{16}$' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'get_sms_delivery_status',
      'error_category', 'validation',
      'message', 'sms_reference must be S- followed by 16 hex characters');
  END IF;

  SELECT * INTO v_intent FROM wam_ai.sms_send_intents i
  WHERE upper(i.sms_ref) = upper(v_ref)
  LIMIT 2;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', 'get_sms_delivery_status',
      'error_category', 'not_found', 'message', 'SMS reference not found');
  END IF;
  IF (SELECT count(*) FROM wam_ai.sms_send_intents i WHERE upper(i.sms_ref) = upper(v_ref)) > 1 THEN
    RETURN jsonb_build_object('status', 'ambiguous', 'operation', 'get_sms_delivery_status',
      'error_category', 'ambiguous_match', 'message', 'sms_reference matches multiple rows');
  END IF;

  IF p_agent_id IS NOT NULL OR NULLIF(btrim(p_agent_business_id), '') IS NOT NULL THEN
    SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_err
    FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
    IF v_err IS NOT NULL THEN
      RETURN v_err || jsonb_build_object('operation', 'get_sms_delivery_status');
    END IF;
    IF v_agent_id IS DISTINCT FROM v_intent.agent_id THEN
      RETURN jsonb_build_object('status', 'error', 'operation', 'get_sms_delivery_status',
        'error_category', 'expected_state_conflict',
        'message', 'sms_reference does not belong to the resolved agent');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'get_sms_delivery_status',
    'sms_reference', v_intent.sms_ref,
    'agent_business_id', v_intent.agent_business_ref,
    'masked_destination', v_intent.masked_destination,
    'provider_outcome', v_intent.status,
    'provider_accepted', v_intent.status = 'provider_accepted',
    'provider_message_id', v_intent.provider_message_id,
    'delivery_confirmed', false,
    'delivery_status', CASE
      WHEN v_intent.status = 'provider_accepted' THEN 'provider_accepted_only'
      WHEN v_intent.status = 'reserved' THEN 'submission_reserved'
      ELSE v_intent.status
    END,
    'evidence_source', 'wam_ai.sms_send_intents',
    'caveats', jsonb_build_array(
      'No handset delivery-report webhook exists in Agent Hub; delivery_confirmed is always false.'
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.prepare_send_agent_sms(
  uuid, text, text, text, uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.finalize_send_agent_sms(
  uuid, uuid, text, text, text, text, text, text, boolean, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.get_agent_sms_history(
  uuid, text, timestamptz, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.get_sms_delivery_status(
  text, uuid, text
) FROM PUBLIC, anon, authenticated;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    REVOKE ALL ON FUNCTION wam_ai.prepare_send_agent_sms(
      uuid, text, text, text, uuid, uuid, text, text, text, text, text, text
    ) FROM wam_ai_business_readonly;
    REVOKE ALL ON FUNCTION wam_ai.finalize_send_agent_sms(
      uuid, uuid, text, text, text, text, text, text, boolean, text
    ) FROM wam_ai_business_readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    REVOKE ALL ON FUNCTION wam_ai.get_agent_sms_history(
      uuid, text, timestamptz, timestamptz, integer
    ) FROM wam_ai_business_actions;
    REVOKE ALL ON FUNCTION wam_ai.get_sms_delivery_status(
      text, uuid, text
    ) FROM wam_ai_business_actions;
  END IF;
END;
$priv$;

COMMENT ON FUNCTION wam_ai.prepare_send_agent_sms IS
  'MCP: reserve single-agent SMS after validation; returns normalized destination for provider call.';
COMMENT ON FUNCTION wam_ai.finalize_send_agent_sms IS
  'MCP: record Onfon submission outcome after reservation binding (correlation/actor/role); audit uses reserved identity; never claims handset delivery.';
COMMENT ON FUNCTION wam_ai.get_agent_sms_history IS
  'MCP: bounded SMS history from in-app copies (channel=sms).';
COMMENT ON FUNCTION wam_ai.get_sms_delivery_status IS
  'MCP: ledger-backed provider outcome for S- references; delivery_confirmed always false.';

CREATE OR REPLACE FUNCTION wam_ai.preview_agent_sms_recipient(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_phone_target text DEFAULT 'airtel'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_err jsonb;
  v_agent record;
  v_phone_target text := lower(coalesce(NULLIF(btrim(p_phone_target), ''), 'airtel'));
  v_raw text;
  v_msisdn text;
BEGIN
  IF v_phone_target NOT IN ('airtel', 'safaricom') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'preview_agent_sms_recipient',
      'error_category', 'validation', 'message', 'phone_target must be airtel or safaricom');
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_err IS NOT NULL THEN
    RETURN v_err || jsonb_build_object('operation', 'preview_agent_sms_recipient');
  END IF;

  SELECT a.id, a.name, a.status, a.airtel_phone, a.safaricom_phone
  INTO v_agent FROM public.agents a WHERE a.id = v_agent_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', 'preview_agent_sms_recipient',
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;

  v_raw := CASE v_phone_target WHEN 'safaricom' THEN v_agent.safaricom_phone ELSE v_agent.airtel_phone END;
  v_msisdn := wam_ai.normalize_kenyan_msisdn(v_raw);
  IF v_msisdn IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'preview_agent_sms_recipient',
      'error_category', 'recipient_unreachable',
      'message', format('No valid %s phone on agent profile', v_phone_target),
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'agent_status', v_agent.status);
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'preview_agent_sms_recipient',
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'recipient_display_name', left(coalesce(v_agent.name, 'Agent'), 80),
    'agent_status', v_agent.status,
    'phone_target', v_phone_target,
    'masked_destination', wam_ai.mask_kenyan_msisdn(v_msisdn),
    'destination_fingerprint', wam_ai.sms_destination_fingerprint(v_msisdn),
    'sms_eligible', v_agent.status IN ('approved', 'pending', 'banned', 'rejected'),
    'warnings', jsonb_build_array(
      'Show masked_destination and exact message body before requesting explicit final confirmation.',
      'Never expose destination_fingerprint as a phone number; it is an opaque stale-state check.'
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.preview_agent_sms_recipient(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

DO $priv2$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    REVOKE ALL ON FUNCTION wam_ai.preview_agent_sms_recipient(uuid, text, text)
      FROM wam_ai_business_actions;
  END IF;
END;
$priv2$;

COMMENT ON FUNCTION wam_ai.preview_agent_sms_recipient IS
  'MCP: resolve masked destination + destination_fingerprint for SMS confirmation preview.';
