-- =============================================================================
-- WAM APPS AI Phase 1A.5 — agent configuration actions
-- Mirrors admin agent-actions (set pending), fallback route, service-radius route.
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai.set_agent_pending(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_agent_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_agent record;
  v_result jsonb;
  v_operation constant text := 'set_agent_pending';
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation', 'message', 'Required parameters missing');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized');
  END IF;
  IF NULLIF(btrim(p_expected_agent_status), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'validation', 'message', 'expected_agent_status is required');
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', v_operation);
  END IF;

  v_fingerprint := wam_ai.agent_action_fingerprint(v_agent_id, v_operation, 'pending', p_actor_id);
  PERFORM wam_ai._action_idempotency_advisory_lock(v_operation, p_idempotency_key);

  BEGIN
    SELECT * INTO v_existing
    FROM wam_ai._agent_idempotency_begin(p_idempotency_key, v_operation, v_fingerprint);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'idempotency_conflict', 'message', 'Idempotency key reused with different target');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'idempotent_replay', true, 'operation', v_operation,
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT a.id, a.status, a.name, a.lead_dispatch_scope INTO v_agent
  FROM public.agents a WHERE a.id = v_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', v_operation, 'error_category', 'not_found');
  END IF;

  IF v_agent.status IS DISTINCT FROM p_expected_agent_status THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'expected_state_conflict',
      'message', 'Agent status changed since preview',
      'previous_agent_status', v_agent.status,
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  IF v_agent.status = 'pending' THEN
    v_result := jsonb_build_object('status', 'success', 'operation', v_operation, 'already_completed', true,
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'previous_agent_status', 'pending', 'resulting_agent_status', 'pending',
      'audit_reference', p_correlation_id::text);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, agent_business_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, v_operation, p_correlation_id, p_actor_id, p_actor_role,
      v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);
    RETURN v_result;
  END IF;

  IF v_agent.status <> 'approved' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'invalid_transition',
      'message', 'Only approved agents can be set to pending',
      'previous_agent_status', v_agent.status);
  END IF;

  UPDATE public.agents SET status = 'pending' WHERE id = v_agent_id;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', v_operation, 'changed', true,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'previous_agent_status', v_agent.status, 'resulting_agent_status', 'pending',
    'dispatch_availability_cleared', true,
    'financial_effect', jsonb_build_object('changed', false),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    agent_business_ref, previous_agent_status, resulting_agent_status, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, v_operation,
    wam_ai.agent_business_id(v_agent_id), v_agent.status, 'pending', 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, agent_business_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, v_operation, p_correlation_id, p_actor_id, p_actor_role,
    v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

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
      'error_category', 'action_not_authorized');
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
      'error_category', 'action_not_authorized');
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

REVOKE ALL ON FUNCTION wam_ai.set_agent_pending(
  uuid, text, uuid, uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.set_agent_fallback_dispatch(
  uuid, text, boolean, integer, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.set_agent_service_radius(
  uuid, text, double precision, boolean, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN ('set_agent_pending', 'set_agent_fallback_dispatch', 'set_agent_service_radius')
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

COMMENT ON FUNCTION wam_ai.set_agent_pending IS
  'MCP: wam.business.agents.set_agent_pending — approved → pending; trigger clears dispatch availability.';
COMMENT ON FUNCTION wam_ai.set_agent_fallback_dispatch IS
  'MCP: wam.business.agents.set_agent_fallback_dispatch — configure fallback dispatch pool membership.';
COMMENT ON FUNCTION wam_ai.set_agent_service_radius IS
  'MCP: wam.business.agents.set_agent_service_radius — set/clamp agent service radius (0.5–50 km).';
