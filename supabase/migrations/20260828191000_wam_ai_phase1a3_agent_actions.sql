-- =============================================================================
-- WAM APPS AI Phase 1A.3 — agent management actions
-- Mirrors admin-dashboard agent-actions.tsx and dispatch-scope route semantics.
-- Does NOT revoke Supabase Auth sessions. Does NOT redistribute lead workload on ban.
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai._resolve_agent_for_action(
  p_agent_id uuid,
  p_agent_business_id text,
  OUT v_agent_id uuid,
  OUT v_error jsonb
)
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_ref text := wam_ai.normalize_agent_business_ref(p_agent_business_id);
  v_count integer;
BEGIN
  v_agent_id := p_agent_id;
  IF NULLIF(btrim(p_agent_business_id), '') IS NOT NULL AND v_ref IS NULL THEN
    v_error := jsonb_build_object(
      'status', 'error', 'error_category', 'validation',
      'message', 'Invalid agent_business_id; raw UUID strings are not accepted as safe references');
    RETURN;
  END IF;
  IF v_agent_id IS NOT NULL AND v_ref IS NOT NULL
     AND wam_ai.agent_business_id(v_agent_id) <> v_ref THEN
    v_error := jsonb_build_object(
      'status', 'ambiguous', 'error_category', 'ambiguous_match',
      'message', 'agent_id and agent_business_id refer to different agents');
    RETURN;
  END IF;
  IF v_agent_id IS NULL THEN
    SELECT count(*)::int INTO v_count FROM public.agents a
    WHERE wam_ai.agent_business_id(a.id) = v_ref;
    IF v_count = 0 THEN
      v_error := jsonb_build_object('status', 'not_found', 'error_category', 'not_found', 'message', 'Agent not found');
      RETURN;
    END IF;
    IF v_count > 1 THEN
      v_error := jsonb_build_object('status', 'ambiguous', 'error_category', 'ambiguous_match',
        'message', 'agent_business_id matches multiple agents');
      RETURN;
    END IF;
    SELECT a.id INTO v_agent_id FROM public.agents a
    WHERE wam_ai.agent_business_id(a.id) = v_ref
    ORDER BY a.id LIMIT 1;
  END IF;
  v_error := NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._agent_idempotency_begin(
  p_idempotency_key uuid,
  p_operation text,
  p_fingerprint text
) RETURNS wam_ai.action_requests
LANGUAGE plpgsql SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_existing wam_ai.action_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM wam_ai.action_requests ar
  WHERE ar.idempotency_key = p_idempotency_key
    AND ar.operation_name = p_operation
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> p_fingerprint THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing;
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai._resolve_agent_for_action(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._agent_idempotency_begin(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- approve_agent: pending|rejected → approved; lead_dispatch_scope → none
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.approve_agent(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_agent_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_agent record;
  v_prev_status text;
  v_prev_scope text;
  v_result jsonb;
  v_summary text := left(coalesce(NULLIF(btrim(p_instruction_summary), ''), 'approve_agent'), 200);
  v_notif boolean := false;
  v_since timestamptz := clock_timestamp();
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'approve_agent',
      'error_category', 'validation', 'message', 'idempotency_key, correlation_id, actor_id and actor_role are required');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'approve_agent',
      'error_category', 'action_not_authorized', 'message', 'Actor role not authorized');
  END IF;
  IF NULLIF(btrim(p_expected_agent_status), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'approve_agent',
      'error_category', 'validation', 'message', 'expected_agent_status is required');
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', 'approve_agent');
  END IF;

  v_fingerprint := wam_ai.agent_action_fingerprint(v_agent_id, 'approve_agent', 'approved', p_actor_id);
  BEGIN
    SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key, 'approve_agent', v_fingerprint);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%idempotency_conflict%' OR SQLSTATE = '23505' THEN
      RETURN jsonb_build_object('status', 'error', 'operation', 'approve_agent',
        'error_category', 'idempotency_conflict',
        'message', 'Idempotency key reused with different actor or target');
    END IF;
    RAISE;
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END,
      'idempotent_replay', true, 'operation', 'approve_agent');
  END IF;

  SELECT a.id, a.status, a.lead_dispatch_scope, a.name INTO v_agent
  FROM public.agents a WHERE a.id = v_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', 'approve_agent',
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;

  v_prev_status := v_agent.status;
  v_prev_scope := coalesce(v_agent.lead_dispatch_scope, 'none');

  IF v_agent.status IS DISTINCT FROM p_expected_agent_status THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'approve_agent',
      'error_category', 'expected_state_conflict',
      'message', 'Agent status changed since preview',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'previous_agent_status', v_prev_status);
  END IF;

  IF v_agent.status = 'approved' THEN
    v_result := jsonb_build_object(
      'status', 'success', 'operation', 'approve_agent', 'idempotent_replay', false,
      'already_completed', true,
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'previous_agent_status', v_prev_status, 'resulting_agent_status', 'approved',
      'lead_dispatch_scope', v_prev_scope,
      'auth_session_revoked', false,
      'notification_summary', jsonb_build_object('created', false, 'reason', 'already_approved'),
      'financial_effect', jsonb_build_object('changed', false),
      'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, agent_business_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, 'approve_agent', p_correlation_id, p_actor_id, p_actor_role,
      v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);
    RETURN v_result;
  END IF;

  IF v_agent.status NOT IN ('pending', 'rejected') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'approve_agent',
      'error_category', 'invalid_transition',
      'message', 'Only pending or rejected agents can be approved',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'previous_agent_status', v_prev_status);
  END IF;

  UPDATE public.agents
  SET status = 'approved', lead_dispatch_scope = 'none'
  WHERE id = v_agent_id;

  v_notif := wam_ai._notification_row_created(v_agent_id, 'ACCOUNT_STATUS_CHANGE', v_since);

  v_result := jsonb_build_object(
    'status', 'success', 'operation', 'approve_agent', 'idempotent_replay', false,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'agent_name', v_agent.name,
    'previous_agent_status', v_prev_status, 'resulting_agent_status', 'approved',
    'previous_dispatch_scope', v_prev_scope, 'resulting_dispatch_scope', 'none',
    'auth_session_revoked', false,
    'operational_setup_required', jsonb_build_array(
      'Enable inbound lead dispatch scope separately if leads should be offered',
      'Agent must turn on Receive leads in the app after scope is enabled'
    ),
    'notification_summary', jsonb_build_object(
      'type', 'ACCOUNT_STATUS_CHANGE', 'created', v_notif,
      'source', CASE WHEN v_notif THEN 'database_trigger' ELSE 'none' END,
      'push_delivery', 'not_sent_from_rpc',
      'recipient', 'agent'
    ),
    'financial_effect', jsonb_build_object('changed', false),
    'instruction_summary', v_summary,
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    agent_business_ref, previous_agent_status, resulting_agent_status,
    dispatch_scope_previous, dispatch_scope_resulting, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, 'approve_agent',
    wam_ai.agent_business_id(v_agent_id), v_prev_status, 'approved',
    v_prev_scope, 'none', 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, agent_business_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, 'approve_agent', p_correlation_id, p_actor_id, p_actor_role,
    v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- reject_agent: pending → rejected
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.reject_agent(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_agent_status text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_agent record;
  v_prev_status text;
  v_result jsonb;
  v_reason text := left(coalesce(NULLIF(btrim(p_reason), ''), ''), 200);
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'reject_agent',
      'error_category', 'validation', 'message', 'Required parameters missing');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'reject_agent',
      'error_category', 'action_not_authorized', 'message', 'Actor role not authorized');
  END IF;
  IF NULLIF(btrim(p_expected_agent_status), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'reject_agent',
      'error_category', 'validation', 'message', 'expected_agent_status is required');
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', 'reject_agent');
  END IF;

  v_fingerprint := wam_ai.agent_action_fingerprint(v_agent_id, 'reject_agent', 'rejected', p_actor_id);
  BEGIN
    SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key, 'reject_agent', v_fingerprint);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'reject_agent',
      'error_category', 'idempotency_conflict',
      'message', 'Idempotency key reused with different actor or target');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END,
      'idempotent_replay', true, 'operation', 'reject_agent');
  END IF;

  SELECT a.id, a.status, a.name INTO v_agent FROM public.agents a WHERE a.id = v_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', 'reject_agent',
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;
  v_prev_status := v_agent.status;

  IF v_agent.status IS DISTINCT FROM p_expected_agent_status THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'reject_agent',
      'error_category', 'expected_state_conflict', 'message', 'Agent status changed since preview',
      'previous_agent_status', v_prev_status);
  END IF;

  IF v_agent.status = 'rejected' THEN
    v_result := jsonb_build_object('status', 'success', 'operation', 'reject_agent',
      'already_completed', true, 'previous_agent_status', v_prev_status, 'resulting_agent_status', 'rejected',
      'auth_session_revoked', false, 'financial_effect', jsonb_build_object('changed', false),
      'audit_reference', p_correlation_id::text);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, agent_business_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, 'reject_agent', p_correlation_id, p_actor_id, p_actor_role,
      v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);
    RETURN v_result;
  END IF;

  IF v_agent.status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'reject_agent',
      'error_category', 'invalid_transition',
      'message', 'Only pending agents can be rejected',
      'previous_agent_status', v_prev_status);
  END IF;

  UPDATE public.agents SET status = 'rejected' WHERE id = v_agent_id;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', 'reject_agent', 'idempotent_replay', false,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'previous_agent_status', v_prev_status, 'resulting_agent_status', 'rejected',
    'reason', NULLIF(v_reason, ''),
    'auth_session_revoked', false,
    'dispatch_availability_cleared', true,
    'notification_summary', jsonb_build_object(
      'type', 'ACCOUNT_STATUS_CHANGE',
      'created', wam_ai._notification_row_created(v_agent_id, 'ACCOUNT_STATUS_CHANGE', clock_timestamp() - interval '2 seconds'),
      'source', CASE WHEN wam_ai._notification_row_created(v_agent_id, 'ACCOUNT_STATUS_CHANGE', clock_timestamp() - interval '2 seconds') THEN 'database_trigger' ELSE 'none' END,
      'push_delivery', 'not_sent_from_rpc'),
    'financial_effect', jsonb_build_object('changed', false),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    agent_business_ref, previous_agent_status, resulting_agent_status, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, 'reject_agent',
    wam_ai.agent_business_id(v_agent_id), v_prev_status, 'rejected', 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, agent_business_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, 'reject_agent', p_correlation_id, p_actor_id, p_actor_role,
    v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- ban_agent: approved → banned; reports workload, does not modify offers/leads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.ban_agent(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_agent_status text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_agent record;
  v_prev_status text;
  v_active_offers integer := 0;
  v_assigned_leads integer := 0;
  v_result jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'ban_agent',
      'error_category', 'validation', 'message', 'Required parameters missing');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'ban_agent',
      'error_category', 'action_not_authorized', 'message', 'Actor role not authorized');
  END IF;
  IF NULLIF(btrim(p_expected_agent_status), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'ban_agent',
      'error_category', 'validation', 'message', 'expected_agent_status is required');
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', 'ban_agent');
  END IF;

  v_fingerprint := wam_ai.agent_action_fingerprint(v_agent_id, 'ban_agent', 'banned', p_actor_id);
  BEGIN
    SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key, 'ban_agent', v_fingerprint);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'ban_agent',
      'error_category', 'idempotency_conflict', 'message', 'Idempotency key reused with different actor or target');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END,
      'idempotent_replay', true, 'operation', 'ban_agent');
  END IF;

  SELECT a.id, a.status, a.name, a.lead_dispatch_scope INTO v_agent
  FROM public.agents a WHERE a.id = v_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', 'ban_agent',
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;
  v_prev_status := v_agent.status;

  IF v_agent.status IS DISTINCT FROM p_expected_agent_status THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'ban_agent',
      'error_category', 'expected_state_conflict', 'previous_agent_status', v_prev_status);
  END IF;

  SELECT count(*)::int INTO v_active_offers
  FROM public.lead_offers o
  WHERE o.agent_id = v_agent_id AND o.status = 'offered';

  SELECT count(*)::int INTO v_assigned_leads
  FROM public.inbound_leads l
  WHERE l.assigned_agent_id = v_agent_id
    AND l.status IN ('assigned', 'kyc_in_progress', 'kyc_completed', 'pending_install', 'deferred');

  IF v_agent.status = 'banned' THEN
    v_result := jsonb_build_object('status', 'success', 'operation', 'ban_agent', 'already_completed', true,
      'previous_agent_status', v_prev_status, 'resulting_agent_status', 'banned',
      'outstanding_workload', jsonb_build_object('active_offers', v_active_offers, 'assigned_leads', v_assigned_leads),
      'workload_redistributed', false, 'auth_session_revoked', false,
      'audit_reference', p_correlation_id::text);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, agent_business_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, 'ban_agent', p_correlation_id, p_actor_id, p_actor_role,
      v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);
    RETURN v_result;
  END IF;

  IF v_agent.status <> 'approved' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'ban_agent',
      'error_category', 'invalid_transition',
      'message', 'Only approved agents can be banned',
      'previous_agent_status', v_prev_status);
  END IF;

  UPDATE public.agents SET status = 'banned' WHERE id = v_agent_id;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', 'ban_agent', 'idempotent_replay', false,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'previous_agent_status', v_prev_status, 'resulting_agent_status', 'banned',
    'auth_session_revoked', false,
    'dispatch_availability_cleared', true,
    'outstanding_workload', jsonb_build_object(
      'active_offers', v_active_offers,
      'assigned_leads', v_assigned_leads,
      'note', 'Offers and assignments were not modified; use separate recovery actions if needed'
    ),
    'workload_redistributed', false,
    'notification_summary', jsonb_build_object(
      'type', 'ACCOUNT_STATUS_CHANGE',
      'created', wam_ai._notification_row_created(v_agent_id, 'ACCOUNT_STATUS_CHANGE', clock_timestamp() - interval '2 seconds'),
      'source', CASE WHEN wam_ai._notification_row_created(v_agent_id, 'ACCOUNT_STATUS_CHANGE', clock_timestamp() - interval '2 seconds') THEN 'database_trigger' ELSE 'none' END,
      'push_delivery', 'not_sent_from_rpc'),
    'financial_effect', jsonb_build_object('changed', false),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    agent_business_ref, previous_agent_status, resulting_agent_status, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, 'ban_agent',
    wam_ai.agent_business_id(v_agent_id), v_prev_status, 'banned', 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, agent_business_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, 'ban_agent', p_correlation_id, p_actor_id, p_actor_role,
    v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- restore_agent: banned → approved; does not restore scope or availability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.restore_agent(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_agent_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_agent record;
  v_prev_status text;
  v_scope text;
  v_available boolean;
  v_result jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'restore_agent',
      'error_category', 'validation', 'message', 'Required parameters missing');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'restore_agent',
      'error_category', 'action_not_authorized', 'message', 'Actor role not authorized');
  END IF;
  IF NULLIF(btrim(p_expected_agent_status), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'restore_agent',
      'error_category', 'validation', 'message', 'expected_agent_status is required');
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', 'restore_agent');
  END IF;

  v_fingerprint := wam_ai.agent_action_fingerprint(v_agent_id, 'restore_agent', 'approved', p_actor_id);
  BEGIN
    SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key, 'restore_agent', v_fingerprint);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'restore_agent',
      'error_category', 'idempotency_conflict', 'message', 'Idempotency key reused with different actor or target');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'idempotent_replay', true, 'operation', 'restore_agent',
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT a.id, a.status, a.lead_dispatch_scope INTO v_agent
  FROM public.agents a WHERE a.id = v_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', 'restore_agent',
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;
  v_prev_status := v_agent.status;
  v_scope := coalesce(v_agent.lead_dispatch_scope, 'none');

  IF v_agent.status IS DISTINCT FROM p_expected_agent_status THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'restore_agent',
      'error_category', 'expected_state_conflict', 'previous_agent_status', v_prev_status);
  END IF;

  SELECT coalesce(ads.is_available, false) INTO v_available
  FROM public.agent_dispatch_settings ads WHERE ads.agent_id = v_agent_id;

  IF v_agent.status = 'approved' THEN
    v_result := jsonb_build_object('status', 'success', 'operation', 'restore_agent', 'already_completed', true,
      'previous_agent_status', v_prev_status, 'resulting_agent_status', 'approved',
      'audit_reference', p_correlation_id::text);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, agent_business_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, 'restore_agent', p_correlation_id, p_actor_id, p_actor_role,
      v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);
    RETURN v_result;
  END IF;

  IF v_agent.status <> 'banned' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'restore_agent',
      'error_category', 'invalid_transition',
      'message', 'Only banned agents can be restored via unban',
      'previous_agent_status', v_prev_status);
  END IF;

  UPDATE public.agents SET status = 'approved' WHERE id = v_agent_id;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', 'restore_agent', 'idempotent_replay', false,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'previous_agent_status', v_prev_status, 'resulting_agent_status', 'approved',
    'lead_dispatch_scope', v_scope,
    'is_available', coalesce(v_available, false),
    'auth_session_revoked', false,
    'operational_setup_required', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
      FROM (
        SELECT 'Re-enable lead dispatch scope if leads should be offered' AS x
        WHERE v_scope = 'none'
        UNION ALL
        SELECT 'Agent must turn on Receive leads in the app'
        WHERE NOT coalesce(v_available, false)
      ) s
    ),
    'notification_summary', jsonb_build_object(
      'type', 'ACCOUNT_STATUS_CHANGE',
      'created', wam_ai._notification_row_created(v_agent_id, 'ACCOUNT_STATUS_CHANGE', clock_timestamp() - interval '2 seconds'),
      'source', CASE WHEN wam_ai._notification_row_created(v_agent_id, 'ACCOUNT_STATUS_CHANGE', clock_timestamp() - interval '2 seconds') THEN 'database_trigger' ELSE 'none' END,
      'push_delivery', 'not_sent_from_rpc'),
    'financial_effect', jsonb_build_object('changed', false),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    agent_business_ref, previous_agent_status, resulting_agent_status, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, 'restore_agent',
    wam_ai.agent_business_id(v_agent_id), v_prev_status, 'approved', 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, agent_business_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, 'restore_agent', p_correlation_id, p_actor_id, p_actor_role,
    v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- change_agent_dispatch_scope: scope only; mirrors PATCH dispatch-scope route
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.change_agent_dispatch_scope(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_dispatch_scope text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_dispatch_scope text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_agent_id uuid;
  v_resolve_err jsonb;
  v_scope text := NULLIF(btrim(p_dispatch_scope), '');
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_agent record;
  v_prev_scope text;
  v_result jsonb;
  v_notified boolean := false;
  v_scope_labels jsonb := '{"airtel":"Airtel","safaricom":"Safaricom","both":"Airtel & Safaricom","none":"none"}'::jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'change_agent_dispatch_scope',
      'error_category', 'validation', 'message', 'Required parameters missing');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'change_agent_dispatch_scope',
      'error_category', 'action_not_authorized', 'message', 'Actor role not authorized');
  END IF;
  IF v_scope IS NULL OR v_scope NOT IN ('both', 'airtel', 'safaricom', 'none') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'change_agent_dispatch_scope',
      'error_category', 'validation', 'message', 'Invalid dispatch scope');
  END IF;
  IF NULLIF(btrim(p_expected_dispatch_scope), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'change_agent_dispatch_scope',
      'error_category', 'validation', 'message', 'expected_dispatch_scope is required');
  END IF;

  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_resolve_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_resolve_err IS NOT NULL THEN
    RETURN v_resolve_err || jsonb_build_object('operation', 'change_agent_dispatch_scope');
  END IF;

  v_fingerprint := wam_ai.agent_action_fingerprint(v_agent_id, 'change_agent_dispatch_scope', v_scope, p_actor_id);
  BEGIN
    SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key, 'change_agent_dispatch_scope', v_fingerprint);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'change_agent_dispatch_scope',
      'error_category', 'idempotency_conflict', 'message', 'Idempotency key reused with different actor or target');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'idempotent_replay', true, 'operation', 'change_agent_dispatch_scope',
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT a.id, a.status, a.lead_dispatch_scope, a.name INTO v_agent
  FROM public.agents a WHERE a.id = v_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', 'change_agent_dispatch_scope',
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;

  v_prev_scope := coalesce(v_agent.lead_dispatch_scope, 'none');

  IF v_prev_scope IS DISTINCT FROM p_expected_dispatch_scope THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'change_agent_dispatch_scope',
      'error_category', 'expected_state_conflict',
      'message', 'Dispatch scope changed since preview',
      'previous_dispatch_scope', v_prev_scope);
  END IF;

  IF v_prev_scope = v_scope THEN
    v_result := jsonb_build_object('status', 'success', 'operation', 'change_agent_dispatch_scope',
      'already_completed', true, 'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'previous_dispatch_scope', v_prev_scope, 'resulting_dispatch_scope', v_scope,
      'audit_reference', p_correlation_id::text);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, agent_business_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, 'change_agent_dispatch_scope', p_correlation_id, p_actor_id, p_actor_role,
      v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);
    RETURN v_result;
  END IF;

  UPDATE public.agents SET lead_dispatch_scope = v_scope WHERE id = v_agent_id;

  IF v_scope = 'none' AND v_prev_scope <> 'none' THEN
    INSERT INTO public.agent_dispatch_settings (agent_id, is_available, updated_at)
    VALUES (v_agent_id, false, now())
    ON CONFLICT (agent_id) DO UPDATE
    SET is_available = false, updated_at = now();
  END IF;

  IF v_prev_scope = 'none' AND v_scope <> 'none' THEN
    INSERT INTO public.notifications (
      agent_id, type, title, message, metadata
    ) VALUES (
      v_agent_id,
      'SYSTEM_ANNOUNCEMENT',
      'You''re cleared for inbound leads',
      format(
        'Admin enabled %s website leads for you. Open the app and turn on Receive leads — notifications must stay on so offers can reach you.',
        coalesce(v_scope_labels->>v_scope, 'inbound')
      ),
      jsonb_build_object(
        'source', 'wam_ai',
        'kind', 'leads_enabled',
        'scope', v_scope,
        'deepLink', 'dashboard'
      )
    );
    v_notified := true;
  END IF;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', 'change_agent_dispatch_scope', 'idempotent_replay', false,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'agent_status', v_agent.status,
    'previous_dispatch_scope', v_prev_scope, 'resulting_dispatch_scope', v_scope,
    'availability_paused', (v_scope = 'none' AND v_prev_scope <> 'none'),
    'notification_summary', jsonb_build_object(
      'created', v_notified,
      'type', CASE WHEN v_notified THEN 'SYSTEM_ANNOUNCEMENT' ELSE NULL END,
      'source', CASE WHEN v_notified THEN 'rpc_insert' ELSE 'none' END,
      'push_delivery', 'not_sent_from_rpc'
    ),
    'account_status_changed', false,
    'auth_session_revoked', false,
    'financial_effect', jsonb_build_object('changed', false),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    agent_business_ref, dispatch_scope_previous, dispatch_scope_resulting, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, 'change_agent_dispatch_scope',
    wam_ai.agent_business_id(v_agent_id), v_prev_scope, v_scope, 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, agent_business_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, 'change_agent_dispatch_scope', p_correlation_id, p_actor_id, p_actor_role,
    v_fingerprint, wam_ai.agent_business_id(v_agent_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

-- Revoke public execution on all agent action RPCs and internal helpers
DO $rev$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN (
        'approve_agent', 'reject_agent', 'ban_agent', 'restore_agent',
        'change_agent_dispatch_scope', '_resolve_agent_for_action', '_agent_idempotency_begin'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly', r.sig);
    END IF;
  END LOOP;
END;
$rev$;

COMMENT ON FUNCTION wam_ai.approve_agent IS 'MCP: wam.business.agents.approve_agent — pending/rejected → approved; scope none.';
COMMENT ON FUNCTION wam_ai.reject_agent IS 'MCP: wam.business.agents.reject_agent — pending → rejected.';
COMMENT ON FUNCTION wam_ai.ban_agent IS 'MCP: wam.business.agents.ban_agent — approved → banned; reports workload only.';
COMMENT ON FUNCTION wam_ai.restore_agent IS 'MCP: wam.business.agents.restore_agent — banned → approved; does not restore scope.';
COMMENT ON FUNCTION wam_ai.change_agent_dispatch_scope IS 'MCP: wam.business.agents.change_dispatch_scope — admin dispatch scope gate.';

-- Production grants (apply manually after role creation):
-- GRANT EXECUTE ON FUNCTION wam_ai.approve_agent(...) TO wam_ai_business_actions;
-- (repeat for each agent action RPC)
