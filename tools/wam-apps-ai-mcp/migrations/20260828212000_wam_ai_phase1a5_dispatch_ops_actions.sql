-- =============================================================================
-- WAM APPS AI Phase 1A.5 — dispatch operational actions
-- expire_lead_offer mirrors lib/dispatch/expire-offers.ts single-offer expiry.
-- Does NOT auto-redispatch (use create_lead_offer or admin retry-dispatch separately).
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai.expire_lead_offer(
  p_offer_id uuid DEFAULT NULL,
  p_offer_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_offer_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_offer_id uuid;
  v_err jsonb;
  v_fp text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_offer record;
  v_lead record;
  v_prev_offer_status text;
  v_prev_lead_status text;
  v_result jsonb;
  v_now timestamptz := now();
  v_remaining_offers integer := 0;
  v_lead_status_after text;
  v_operation constant text := 'expire_lead_offer';
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation, 'error_category', 'validation',
      'message', 'idempotency_key, correlation_id, actor_id and actor_role are required');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation, 'error_category', 'action_not_authorized');
  END IF;
  IF NULLIF(btrim(p_expected_offer_status), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation, 'error_category', 'validation',
      'message', 'expected_offer_status is required');
  END IF;

  SELECT t.v_offer_id, t.v_error INTO v_offer_id, v_err
  FROM wam_ai._resolve_offer_for_action(p_offer_id, p_offer_ref) t;
  IF v_err IS NOT NULL THEN
    RETURN v_err || jsonb_build_object('operation', v_operation);
  END IF;

  PERFORM wam_ai._action_idempotency_advisory_lock(v_operation, p_idempotency_key);

  v_fp := wam_ai.offer_action_fingerprint(v_offer_id, v_operation, p_actor_id);
  BEGIN
    SELECT * INTO v_existing
    FROM wam_ai._agent_idempotency_begin(p_idempotency_key, v_operation, v_fp);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation, 'error_category', 'idempotency_conflict',
      'message', 'Idempotency key reused with different actor or target');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'idempotent_replay', true, 'operation', v_operation,
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT o.* INTO v_offer
  FROM public.lead_offers o WHERE o.id = v_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'not_found', 'operation', v_operation, 'error_category', 'not_found');
  END IF;

  v_prev_offer_status := v_offer.status;
  IF v_prev_offer_status IS DISTINCT FROM p_expected_offer_status THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation, 'error_category', 'expected_state_conflict',
      'message', 'Offer status changed since preview',
      'previous_offer_status', v_prev_offer_status,
      'offer_reference', wam_ai.offer_ref(v_offer_id));
  END IF;

  IF v_prev_offer_status = 'expired' THEN
    v_result := jsonb_build_object(
      'status', 'success', 'operation', v_operation, 'already_completed', true,
      'offer_reference', wam_ai.offer_ref(v_offer_id),
      'previous_offer_status', v_prev_offer_status, 'resulting_offer_status', 'expired',
      'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, offer_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, v_operation, p_correlation_id, p_actor_id, p_actor_role,
      v_fp, wam_ai.offer_ref(v_offer_id), 'success', v_result);
    RETURN v_result;
  END IF;

  IF v_prev_offer_status <> 'offered' THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation, 'error_category', 'invalid_transition',
      'message', format('Cannot expire offer in status %s', v_prev_offer_status),
      'previous_offer_status', v_prev_offer_status);
  END IF;

  SELECT l.* INTO v_lead
  FROM public.inbound_leads l WHERE l.id = v_offer.lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', v_operation, 'error_category', 'not_found',
      'message', 'Lead for offer not found');
  END IF;

  v_prev_lead_status := v_lead.status;

  UPDATE public.lead_offers SET
    status = 'expired',
    responded_at = v_now
  WHERE id = v_offer_id AND status = 'offered';

  IF v_lead.preferred_agent_id IS NOT NULL
     AND v_lead.preferred_agent_id = v_offer.agent_id THEN
    UPDATE public.inbound_leads SET preferred_agent_id = NULL WHERE id = v_lead.id;
  END IF;

  SELECT count(*)::int INTO v_remaining_offers
  FROM public.lead_offers o
  WHERE o.lead_id = v_lead.id AND o.status = 'offered';

  v_lead_status_after := v_prev_lead_status;
  IF v_prev_lead_status = 'offered' AND v_remaining_offers = 0 THEN
    UPDATE public.inbound_leads SET status = 'needs_reassignment' WHERE id = v_lead.id;
    v_lead_status_after := 'needs_reassignment';
  END IF;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', v_operation, 'idempotent_replay', false,
    'already_completed', false, 'changed', true,
    'offer_reference', wam_ai.offer_ref(v_offer_id),
    'lead_ref', wam_ai.lead_ref(v_lead.id),
    'previous_offer_status', v_prev_offer_status, 'resulting_offer_status', 'expired',
    'previous_lead_status', v_prev_lead_status, 'resulting_lead_status', v_lead_status_after,
    'remaining_active_offers', v_remaining_offers,
    'financial_effect', jsonb_build_object('changed', false),
    'notification_summary', jsonb_build_object('created', false, 'reason', 'no_notification_on_manual_expire'),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id,
    'action_reference', p_idempotency_key::text);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    lead_ref, offer_ref, previous_lead_status, resulting_lead_status, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, v_operation,
    wam_ai.lead_ref(v_lead.id), wam_ai.offer_ref(v_offer_id),
    v_prev_lead_status, v_lead_status_after, 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, lead_ref, offer_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, v_operation, p_correlation_id, p_actor_id, p_actor_role,
    v_fp, wam_ai.lead_ref(v_lead.id), wam_ai.offer_ref(v_offer_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.expire_lead_offer(
  uuid, text, uuid, uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    REVOKE ALL ON FUNCTION wam_ai.expire_lead_offer(
      uuid, text, uuid, uuid, text, text, text, text
    ) FROM wam_ai_business_readonly;
  END IF;
END;
$priv$;

COMMENT ON FUNCTION wam_ai.expire_lead_offer IS
  'MCP: wam.business.dispatch.expire_lead_offer — expire one offered lead offer; may move lead to needs_reassignment.';
