-- =============================================================================
-- WAM APPS AI Phase 1A.5 — registration reopen actions (non-financial)
-- Mirrors registration-status-actions reopen to pending from terminal non-installed states.
-- Refuses installed → pending (financial / earnings risk on Airtel).
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai._reopen_registration_pending(
  p_operation text,
  p_table regclass,
  p_product text,
  p_registration_id uuid,
  p_registration_ref text,
  p_idempotency_key uuid,
  p_correlation_id uuid,
  p_actor_id text,
  p_actor_role text,
  p_expected_registration_status text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_reg_id uuid;
  v_err jsonb;
  v_fp text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_prev text;
  v_result jsonb;
  v_allowed_from text[] := ARRAY['rejected', 'duplicate', 'cancelled'];
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', p_operation,
      'error_category', 'validation', 'message', 'Required parameters missing');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', p_operation,
      'error_category', 'action_not_authorized');
  END IF;
  IF NULLIF(btrim(p_expected_registration_status), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'operation', p_operation,
      'error_category', 'validation', 'message', 'expected_registration_status is required');
  END IF;

  SELECT t.v_registration_id, t.v_error INTO v_reg_id, v_err
  FROM wam_ai._resolve_registration_id(p_registration_id, p_registration_ref, p_table) t;
  IF v_err IS NOT NULL THEN
    RETURN v_err || jsonb_build_object('operation', p_operation);
  END IF;

  PERFORM wam_ai._action_idempotency_advisory_lock(p_operation, p_idempotency_key);

  v_fp := wam_ai.registration_action_fingerprint(v_reg_id, p_operation, p_actor_id);
  BEGIN
    SELECT * INTO v_existing
    FROM wam_ai._agent_idempotency_begin(p_idempotency_key, p_operation, v_fp);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status', 'error', 'operation', p_operation,
      'error_category', 'idempotency_conflict');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object(
      'idempotent_replay', true, 'operation', p_operation,
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END);
  END IF;

  EXECUTE format('SELECT r.status FROM %s r WHERE r.id = $1 FOR UPDATE', p_table)
  INTO v_prev USING v_reg_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', p_operation, 'error_category', 'not_found');
  END IF;

  IF v_prev IS DISTINCT FROM p_expected_registration_status THEN
    RETURN jsonb_build_object('status', 'error', 'operation', p_operation,
      'error_category', 'expected_state_conflict',
      'message', 'Registration status changed since preview',
      'previous_registration_status', v_prev,
      'registration_ref', wam_ai.registration_ref(v_reg_id));
  END IF;

  IF v_prev = 'pending' THEN
    v_result := jsonb_build_object('status', 'success', 'operation', p_operation, 'already_completed', true,
      'registration_ref', wam_ai.registration_ref(v_reg_id),
      'product', p_product, 'previous_registration_status', 'pending', 'resulting_registration_status', 'pending',
      'audit_reference', p_correlation_id::text);
    INSERT INTO wam_ai.action_requests (
      idempotency_key, operation_name, correlation_id, actor_id, actor_role,
      request_fingerprint, registration_ref, outcome, result_payload
    ) VALUES (
      p_idempotency_key, p_operation, p_correlation_id, p_actor_id, p_actor_role,
      v_fp, wam_ai.registration_ref(v_reg_id), 'success', v_result);
    RETURN v_result;
  END IF;

  IF v_prev = 'installed' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', p_operation,
      'error_category', 'invalid_transition',
      'message', 'Cannot reopen installed registration via this action (financial risk)',
      'previous_registration_status', v_prev);
  END IF;

  IF NOT (v_prev = ANY (v_allowed_from)) THEN
    RETURN jsonb_build_object('status', 'error', 'operation', p_operation,
      'error_category', 'invalid_transition',
      'message', format('Cannot reopen registration from status %s', v_prev),
      'previous_registration_status', v_prev);
  END IF;

  EXECUTE format('UPDATE %s SET status = $1 WHERE id = $2', p_table)
  USING 'pending', v_reg_id;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', p_operation, 'changed', true,
    'registration_ref', wam_ai.registration_ref(v_reg_id), 'product', p_product,
    'previous_registration_status', v_prev, 'resulting_registration_status', 'pending',
    'financial_effect', jsonb_build_object('changed', false),
    'notification_summary', jsonb_build_object('created', false),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id);

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    registration_ref, previous_registration_status, resulting_registration_status, outcome
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, p_operation,
    wam_ai.registration_ref(v_reg_id), v_prev, 'pending', 'success');

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, registration_ref, outcome, result_payload
  ) VALUES (
    p_idempotency_key, p_operation, p_correlation_id, p_actor_id, p_actor_role,
    v_fp, wam_ai.registration_ref(v_reg_id), 'success', v_result);

  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.reopen_airtel_registration_pending(
  p_registration_id uuid DEFAULT NULL,
  p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_registration_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT wam_ai._reopen_registration_pending(
    'reopen_airtel_registration_pending', 'public.customer_registrations'::regclass, 'airtel',
    p_registration_id, p_registration_ref, p_idempotency_key, p_correlation_id,
    p_actor_id, p_actor_role, p_expected_registration_status
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.reopen_safaricom_registration_pending(
  p_registration_id uuid DEFAULT NULL,
  p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_registration_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT wam_ai._reopen_registration_pending(
    'reopen_safaricom_registration_pending', 'public.safaricom_registrations'::regclass, 'safaricom',
    p_registration_id, p_registration_ref, p_idempotency_key, p_correlation_id,
    p_actor_id, p_actor_role, p_expected_registration_status
  );
$fn$;

REVOKE ALL ON FUNCTION wam_ai._reopen_registration_pending(
  text, regclass, text, uuid, text, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.reopen_airtel_registration_pending(
  uuid, text, uuid, uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.reopen_safaricom_registration_pending(
  uuid, text, uuid, uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN (
        '_reopen_registration_pending',
        'reopen_airtel_registration_pending',
        'reopen_safaricom_registration_pending'
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

COMMENT ON FUNCTION wam_ai.reopen_airtel_registration_pending IS
  'MCP: wam.business.registrations.reopen_airtel_registration_pending — rejected/duplicate/cancelled → pending.';
COMMENT ON FUNCTION wam_ai.reopen_safaricom_registration_pending IS
  'MCP: wam.business.registrations.reopen_safaricom_registration_pending — rejected/duplicate/cancelled → pending.';
