-- =============================================================================
-- WAM APPS AI Phase 1A.5 — inbound lead pipeline actions (non-financial)
-- Mirrors admin PATCH /api/admin/leads/[id]/status for kyc_completed and pending_install.
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai._mark_lead_pipeline_status(
  p_operation text,
  p_target_status text,
  p_lead_id uuid,
  p_lead_ref text,
  p_idempotency_key uuid,
  p_correlation_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_expected_lead_status text,
  p_allowed_from text[],
  p_clear_commission boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_lead_id uuid;
  v_err jsonb;
  v_fp text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_lead record;
  v_prev text;
  v_result jsonb;
  v_active_offers integer := 0;
  v_commission_before numeric;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', 'validation',
      'message', 'idempotency_key, correlation_id, actor_id and actor_role are required');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', 'action_not_authorized');
  END IF;
  IF NULLIF(btrim(p_expected_lead_status), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', 'validation',
      'message', 'expected_lead_status is required');
  END IF;

  SELECT t.v_lead_id, t.v_error INTO v_lead_id, v_err
  FROM wam_ai._resolve_lead_for_action(p_lead_id, p_lead_ref) t;
  IF v_err IS NOT NULL THEN
    RETURN v_err || jsonb_build_object('operation', p_operation);
  END IF;

  PERFORM wam_ai._action_idempotency_advisory_lock(p_operation, p_idempotency_key);

  v_fp := wam_ai.lead_status_action_fingerprint(v_lead_id, p_operation, p_actor_id);
  BEGIN
    SELECT * INTO v_existing
    FROM wam_ai._agent_idempotency_begin(p_idempotency_key, p_operation, v_fp);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', 'idempotency_conflict',
      'message', 'Idempotency key reused with different actor or target');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'idempotent_replay', true, 'operation', p_operation,
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT l.* INTO v_lead FROM public.inbound_leads l WHERE l.id = v_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'not_found', 'operation', p_operation, 'error_category', 'not_found');
  END IF;

  v_prev := v_lead.status;
  v_commission_before := v_lead.commission_earned_ksh;

  IF v_prev IS DISTINCT FROM p_expected_lead_status THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', 'expected_state_conflict',
      'message', 'Lead status changed since preview', 'previous_lead_status', v_prev,
      'lead_ref', wam_ai.lead_ref(v_lead_id));
  END IF;

  IF v_prev = p_target_status THEN
    v_result := jsonb_build_object(
      'status', 'success', 'operation', p_operation, 'already_completed', true,
      'lead_ref', wam_ai.lead_ref(v_lead_id), 'previous_lead_status', v_prev,
      'resulting_lead_status', p_target_status, 'financial_effect', jsonb_build_object('changed', false),
      'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, lead_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, p_operation, p_correlation_id, p_actor_id, p_actor_role,
      v_fp, wam_ai.lead_ref(v_lead_id), 'success', v_result);
    RETURN v_result;
  END IF;

  IF v_prev = 'installed' THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', 'invalid_transition',
      'message', 'Installed leads require revert_lead_pending_install (financial action)',
      'previous_lead_status', v_prev);
  END IF;

  IF v_prev = ANY (ARRAY['rejected', 'duplicate', 'cancelled', 'lost']) THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', 'invalid_transition',
      'message', 'Lead is in a terminal status', 'previous_lead_status', v_prev);
  END IF;

  IF NOT (v_prev = ANY (p_allowed_from)) THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', 'invalid_transition',
      'message', format('Cannot transition from %s to %s', v_prev, p_target_status),
      'previous_lead_status', v_prev);
  END IF;

  PERFORM 1 FROM public.lead_offers o
  WHERE o.lead_id = v_lead_id AND o.status = 'offered' FOR UPDATE;
  SELECT count(*)::int INTO v_active_offers
  FROM public.lead_offers o WHERE o.lead_id = v_lead_id AND o.status = 'offered';
  IF v_active_offers > 0 THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', 'active_offer_exists',
      'message', 'Lead has an active offer; expire the offer before changing pipeline status',
      'lead_ref', wam_ai.lead_ref(v_lead_id), 'active_offer_count', v_active_offers);
  END IF;

  IF p_clear_commission THEN
    UPDATE public.inbound_leads SET
      status = p_target_status,
      commission_earned_ksh = NULL,
      installed_at = NULL
    WHERE id = v_lead_id;
  ELSE
    UPDATE public.inbound_leads SET status = p_target_status WHERE id = v_lead_id;
  END IF;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', p_operation, 'idempotent_replay', false,
    'already_completed', false, 'changed', true,
    'lead_ref', wam_ai.lead_ref(v_lead_id),
    'previous_lead_status', v_prev, 'resulting_lead_status', p_target_status,
    'financial_effect', jsonb_build_object(
      'changed', p_clear_commission AND v_commission_before IS NOT NULL,
      'kind', CASE WHEN p_clear_commission THEN 'commission_cleared_on_pipeline' ELSE 'none' END,
      'commission_before', v_commission_before,
      'commission_after', CASE WHEN p_clear_commission THEN NULL ELSE v_commission_before END),
    'notification_summary', jsonb_build_object('created', false, 'reason', 'no_notification_for_pipeline_status'),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id,
    'action_reference', p_idempotency_key::text);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    lead_ref, previous_lead_status, resulting_lead_status, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, p_operation,
    wam_ai.lead_ref(v_lead_id), v_prev, p_target_status, 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, lead_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, p_operation, p_correlation_id, p_actor_id, p_actor_role,
    v_fp, wam_ai.lead_ref(v_lead_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.mark_lead_kyc_completed(
  p_lead_id uuid DEFAULT NULL,
  p_lead_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_lead_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT wam_ai._mark_lead_pipeline_status(
    'mark_lead_kyc_completed', 'kyc_completed',
    p_lead_id, p_lead_ref, p_idempotency_key, p_correlation_id,
    p_actor_id, p_actor_role, p_expected_lead_status,
    ARRAY['assigned', 'kyc_in_progress', 'kyc_completed'],
    false
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.mark_lead_pending_install(
  p_lead_id uuid DEFAULT NULL,
  p_lead_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_lead_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT wam_ai._mark_lead_pipeline_status(
    'mark_lead_pending_install', 'pending_install',
    p_lead_id, p_lead_ref, p_idempotency_key, p_correlation_id,
    p_actor_id, p_actor_role, p_expected_lead_status,
    ARRAY['assigned', 'kyc_in_progress', 'kyc_completed', 'pending_install'],
    true
  );
$fn$;

REVOKE ALL ON FUNCTION wam_ai._mark_lead_pipeline_status(text, text, uuid, text, uuid, uuid, text, text, text, text[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.mark_lead_kyc_completed(uuid, text, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.mark_lead_pending_install(uuid, text, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN ('_mark_lead_pipeline_status', 'mark_lead_kyc_completed', 'mark_lead_pending_install')
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

COMMENT ON FUNCTION wam_ai.mark_lead_kyc_completed IS
  'MCP: wam.business.leads.mark_lead_kyc_completed — assigned/kyc_in_progress → kyc_completed (non-financial).';
COMMENT ON FUNCTION wam_ai.mark_lead_pending_install IS
  'MCP: wam.business.leads.mark_lead_pending_install — schedule install review; clears commission (non-financial).';
