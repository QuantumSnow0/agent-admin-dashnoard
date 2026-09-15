-- =============================================================================
-- WAM APPS AI Phase 1A.5 — financial hardening remediation
-- mark_lead_pending_install must not clear commission or other financial fields.
-- Infrastructure agent-config actions restricted to technical_owner at SQL layer.
-- =============================================================================

DROP FUNCTION IF EXISTS wam_ai.mark_lead_kyc_completed(
  uuid, text, uuid, uuid, text, text, text, text
);
DROP FUNCTION IF EXISTS wam_ai.mark_lead_pending_install(
  uuid, text, uuid, uuid, text, text, text, text
);
DROP FUNCTION IF EXISTS wam_ai._mark_lead_pipeline_status(
  text, text, uuid, text, uuid, uuid, text, text, text, text[], boolean
);

CREATE OR REPLACE FUNCTION wam_ai._lead_financial_state_present(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v record;
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT l.commission_earned_ksh, l.installed_at, l.metadata, l.status
  INTO v
  FROM public.inbound_leads l
  WHERE l.id = p_lead_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('present', false, 'reasons', '[]'::jsonb);
  END IF;

  IF v.commission_earned_ksh IS NOT NULL THEN
    v_reasons := array_append(v_reasons, 'commission_earned_ksh');
  END IF;
  IF v.installed_at IS NOT NULL THEN
    v_reasons := array_append(v_reasons, 'installed_at');
  END IF;
  IF v.metadata IS NOT NULL AND v.metadata ? 'installCommission' THEN
    v_reasons := array_append(v_reasons, 'metadata.installCommission');
  END IF;
  IF v.status = 'installed' THEN
    v_reasons := array_append(v_reasons, 'status_installed');
  END IF;

  RETURN jsonb_build_object(
    'present', cardinality(v_reasons) > 0,
    'reasons', to_jsonb(v_reasons),
    'commission_earned_ksh', v.commission_earned_ksh,
    'installed_at', v.installed_at
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._registration_financial_state_present(
  p_registration_id uuid,
  p_table regclass
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_status text;
  v_agent_id uuid;
  v_inbound_lead_id uuid;
  v_lead_fin jsonb;
  v_reasons text[] := ARRAY[]::text[];
  v_installed_history boolean := false;
BEGIN
  IF p_table = 'public.customer_registrations'::regclass THEN
    EXECUTE 'SELECT r.status, r.agent_id, r.inbound_lead_id FROM public.customer_registrations r WHERE r.id = $1'
    INTO v_status, v_agent_id, v_inbound_lead_id USING p_registration_id;
  ELSE
    EXECUTE format('SELECT r.status, r.agent_id FROM %s r WHERE r.id = $1', p_table)
    INTO v_status, v_agent_id USING p_registration_id;
    v_inbound_lead_id := NULL;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('present', false, 'reasons', '[]'::jsonb);
  END IF;

  IF v_status = 'installed' THEN
    v_reasons := array_append(v_reasons, 'status_installed');
  END IF;

  IF v_inbound_lead_id IS NOT NULL THEN
    v_lead_fin := wam_ai._lead_financial_state_present(v_inbound_lead_id);
    IF coalesce((v_lead_fin->>'present')::boolean, false) THEN
      v_reasons := array_append(v_reasons, 'linked_lead_financial_state');
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.related_id = p_registration_id
      AND n.type = 'REGISTRATION_STATUS_CHANGE'
      AND (
        n.metadata->>'status' = 'installed'
        OR n.metadata->>'previousStatus' = 'installed'
      )
  ) INTO v_installed_history;

  IF v_installed_history THEN
    v_reasons := array_append(v_reasons, 'installed_history_notification');
  END IF;

  IF v_agent_id IS NOT NULL AND to_regclass('public.agent_payments') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.agent_payments p
      WHERE p.agent_id = v_agent_id
        AND (
          coalesce(p.reference, '') ILIKE '%' || p_registration_id::text || '%'
          OR coalesce(p.notes, '') ILIKE '%' || p_registration_id::text || '%'
        )
    ) THEN
      v_reasons := array_append(v_reasons, 'agent_payment_reference');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'present', cardinality(v_reasons) > 0,
    'reasons', to_jsonb(v_reasons),
    'registration_status', v_status
  );
END;
$fn$;

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
  p_allowed_from text[]
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
  v_fin jsonb;
  v_error_category text;
  v_commission_before numeric;
  v_installed_before timestamptz;
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
  v_installed_before := v_lead.installed_at;

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

  v_fin := wam_ai._lead_financial_state_present(v_lead_id);
  IF coalesce((v_fin->>'present')::boolean, false) THEN
    v_error_category := CASE
      WHEN v_fin->'reasons' @> to_jsonb(ARRAY['commission_earned_ksh']) THEN 'commission_present'
      ELSE 'financial_state_present'
    END;
    RETURN jsonb_build_object(
      'status', 'error', 'operation', p_operation, 'error_category', v_error_category,
      'message', 'Lead has financial state; refuse silent clearing or inconsistent pipeline transition',
      'lead_ref', wam_ai.lead_ref(v_lead_id),
      'financial_state', v_fin,
      'financial_effect', jsonb_build_object('changed', false));
  END IF;

  UPDATE public.inbound_leads SET status = p_target_status WHERE id = v_lead_id;

  IF EXISTS (
    SELECT 1 FROM public.inbound_leads l
    WHERE l.id = v_lead_id
      AND (
        l.commission_earned_ksh IS DISTINCT FROM v_commission_before
        OR l.installed_at IS DISTINCT FROM v_installed_before
      )
  ) THEN
    RAISE EXCEPTION 'pipeline action mutated financial columns unexpectedly';
  END IF;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', p_operation, 'idempotent_replay', false,
    'already_completed', false, 'changed', true,
    'lead_ref', wam_ai.lead_ref(v_lead_id),
    'previous_lead_status', v_prev, 'resulting_lead_status', p_target_status,
    'financial_effect', jsonb_build_object(
      'changed', false,
      'commission_before', v_commission_before,
      'commission_after', v_commission_before,
      'installed_at_before', v_installed_before,
      'installed_at_after', v_installed_before),
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
    ARRAY['assigned', 'kyc_in_progress', 'kyc_completed']
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
    ARRAY['assigned', 'kyc_in_progress', 'kyc_completed', 'pending_install']
  );
$fn$;

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
  v_fin jsonb;
  v_error_category text;
  v_balance_before numeric;
  v_earnings_before numeric;
  v_agent_id uuid;
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

  EXECUTE format('SELECT r.status, r.agent_id FROM %s r WHERE r.id = $1 FOR UPDATE', p_table)
  INTO v_prev, v_agent_id USING v_reg_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', p_operation, 'error_category', 'not_found');
  END IF;

  IF v_agent_id IS NOT NULL THEN
    SELECT a.total_earnings, a.available_balance
    INTO v_earnings_before, v_balance_before
    FROM public.agents a WHERE a.id = v_agent_id;
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
      'financial_effect', jsonb_build_object('changed', false),
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

  v_fin := wam_ai._registration_financial_state_present(v_reg_id, p_table);
  IF coalesce((v_fin->>'present')::boolean, false) THEN
    v_error_category := CASE
      WHEN v_fin->'reasons' @> to_jsonb(ARRAY['linked_lead_financial_state']) THEN 'commission_present'
      WHEN v_fin->'reasons' @> to_jsonb(ARRAY['agent_payment_reference']) THEN 'financial_state_present'
      ELSE 'financial_state_present'
    END;
    RETURN jsonb_build_object('status', 'error', 'operation', p_operation,
      'error_category', v_error_category,
      'message', 'Registration has financial or settlement evidence; reopen refused',
      'registration_ref', wam_ai.registration_ref(v_reg_id),
      'financial_state', v_fin,
      'financial_effect', jsonb_build_object('changed', false));
  END IF;

  EXECUTE format('UPDATE %s SET status = $1 WHERE id = $2', p_table)
  USING 'pending', v_reg_id;

  IF v_agent_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.agents a
    WHERE a.id = v_agent_id
      AND (
        a.total_earnings IS DISTINCT FROM v_earnings_before
        OR a.available_balance IS DISTINCT FROM v_balance_before
      )
  ) THEN
    RAISE EXCEPTION 'registration reopen mutated agent earnings unexpectedly';
  END IF;

  v_result := jsonb_build_object(
    'status', 'success', 'operation', p_operation, 'changed', true,
    'registration_ref', wam_ai.registration_ref(v_reg_id), 'product', p_product,
    'previous_registration_status', v_prev, 'resulting_registration_status', 'pending',
    'financial_effect', jsonb_build_object('changed', false),
    'notification_summary', jsonb_build_object(
      'created', CASE WHEN p_table = 'public.customer_registrations'::regclass
        THEN wam_ai._notification_row_created(v_agent_id, 'REGISTRATION_STATUS_CHANGE', clock_timestamp() - interval '2 seconds')
        ELSE false END,
      'source', CASE WHEN p_table = 'public.customer_registrations'::regclass
        AND wam_ai._notification_row_created(v_agent_id, 'REGISTRATION_STATUS_CHANGE', clock_timestamp() - interval '2 seconds')
        THEN 'database_trigger' ELSE 'none' END,
      'push_delivery', 'not_sent_from_rpc'),
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
  v_active_offers integer := 0;
  v_assigned_leads integer := 0;
  v_scope_before text;
  v_available_before boolean;
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

  v_scope_before := v_agent.lead_dispatch_scope;
  SELECT coalesce(ads.is_available, false) INTO v_available_before
  FROM public.agent_dispatch_settings ads WHERE ads.agent_id = v_agent_id;

  IF v_agent.status IS DISTINCT FROM p_expected_agent_status THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'expected_state_conflict',
      'message', 'Agent status changed since preview',
      'previous_agent_status', v_agent.status,
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  SELECT count(*)::int INTO v_active_offers
  FROM public.lead_offers o WHERE o.agent_id = v_agent_id AND o.status = 'offered';
  SELECT count(*)::int INTO v_assigned_leads
  FROM public.inbound_leads l
  WHERE l.assigned_agent_id = v_agent_id
    AND l.status IN ('assigned', 'kyc_in_progress', 'kyc_completed', 'pending_install', 'deferred');

  IF v_agent.status = 'pending' THEN
    v_result := jsonb_build_object('status', 'success', 'operation', v_operation, 'already_completed', true,
      'agent_business_id', wam_ai.agent_business_id(v_agent_id),
      'previous_agent_status', 'pending', 'resulting_agent_status', 'pending',
      'dispatch_scope_unchanged', v_scope_before,
      'outstanding_workload', jsonb_build_object('active_offers', v_active_offers, 'assigned_leads', v_assigned_leads),
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
    'dispatch_scope_unchanged', v_scope_before,
    'dispatch_scope_resulting', v_scope_before,
    'availability_before', v_available_before,
    'dispatch_availability_cleared', true,
    'outstanding_workload', jsonb_build_object(
      'active_offers', v_active_offers,
      'assigned_leads', v_assigned_leads,
      'note', 'Offers and assignments were not modified; canonical admin only changes account status'
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
  IF p_actor_role <> 'technical_owner' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'Infrastructure dispatch configuration requires technical_owner');
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
  IF p_actor_role <> 'technical_owner' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'Infrastructure dispatch configuration requires technical_owner');
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

REVOKE ALL ON FUNCTION wam_ai._lead_financial_state_present(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._registration_financial_state_present(uuid, regclass) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._mark_lead_pipeline_status(
  text, text, uuid, text, uuid, uuid, text, text, text, text[]
) FROM PUBLIC, anon, authenticated;

-- DROP+CREATE resets ACLs; revoke broad EXECUTE then restore the actions grant.
REVOKE ALL ON FUNCTION wam_ai.mark_lead_kyc_completed(
  uuid, text, uuid, uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.mark_lead_pending_install(
  uuid, text, uuid, uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN (
        '_lead_financial_state_present',
        '_registration_financial_state_present',
        '_mark_lead_pipeline_status',
        '_reopen_registration_pending',
        'reopen_airtel_registration_pending',
        'reopen_safaricom_registration_pending',
        'set_agent_pending',
        'set_agent_fallback_dispatch',
        'set_agent_service_radius'
      )
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_actions', r.sig);
    END IF;
  END LOOP;

  -- Recreated lead pipeline action RPCs: strip broad/readonly access, keep actions grant.
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN ('mark_lead_kyc_completed', 'mark_lead_pending_install')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO wam_ai_business_actions', r.sig);
    END IF;
  END LOOP;
END;
$priv$;

COMMENT ON FUNCTION wam_ai.mark_lead_pending_install IS
  'MCP: wam.business.leads.mark_lead_pending_install — operational pending_install only; refuses financial state; never clears commission.';
COMMENT ON FUNCTION wam_ai.set_agent_fallback_dispatch IS
  'MCP: wam.business.agents.set_agent_fallback_dispatch — technical_owner only; fallback pool configuration.';
COMMENT ON FUNCTION wam_ai.set_agent_service_radius IS
  'MCP: wam.business.agents.set_agent_service_radius — technical_owner only; service radius configuration.';
