-- =============================================================================
-- WAM APPS AI Phase 1A.3 — registration status actions (Airtel + Safaricom)
-- Mirrors registration-status-actions.tsx with conservative transition guards.
-- confirm_*_installation may trigger earnings recalculation (Airtel) via DB triggers.
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai._resolve_registration_id(
  p_registration_id uuid,
  p_registration_ref text,
  p_table regclass,
  OUT v_registration_id uuid,
  OUT v_error jsonb
)
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_ref text := NULLIF(btrim(p_registration_ref), '');
  v_count integer;
BEGIN
  v_registration_id := p_registration_id;
  IF v_registration_id IS NOT NULL AND v_ref IS NOT NULL
     AND wam_ai.registration_ref(v_registration_id) <> v_ref THEN
    v_error := jsonb_build_object('status', 'ambiguous', 'error_category', 'ambiguous_match',
      'message', 'registration_id and registration_ref refer to different records');
    RETURN;
  END IF;
  IF v_registration_id IS NULL THEN
    EXECUTE format(
      'SELECT count(*)::int FROM %s r WHERE wam_ai.registration_ref(r.id) = $1', p_table
    ) INTO v_count USING v_ref;
    IF v_count = 0 THEN
      v_error := jsonb_build_object('status', 'not_found', 'error_category', 'not_found',
        'message', 'Registration not found');
      RETURN;
    END IF;
    IF v_count > 1 THEN
      v_error := jsonb_build_object('status', 'ambiguous', 'error_category', 'ambiguous_match',
        'message', 'registration_ref matches multiple records');
      RETURN;
    END IF;
    EXECUTE format(
      'SELECT r.id FROM %s r WHERE wam_ai.registration_ref(r.id) = $1 LIMIT 1', p_table
    ) INTO v_registration_id USING v_ref;
  END IF;
  v_error := NULL;
END;
$fn$;

-- Airtel: pending → rejected
CREATE OR REPLACE FUNCTION wam_ai.reject_airtel_registration(
  p_registration_id uuid DEFAULT NULL,
  p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_registration_status text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_reg_id uuid;
  v_err jsonb;
  v_fp text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_prev text;
  v_result jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','reject_airtel_registration',
      'error_category','validation','message','Required parameters missing');
  END IF;
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN
    RETURN jsonb_build_object('status','error','operation','reject_airtel_registration',
      'error_category','action_not_authorized','message','Actor role not authorized');
  END IF;
  SELECT t.v_registration_id, t.v_error INTO v_reg_id, v_err
  FROM wam_ai._resolve_registration_id(p_registration_id, p_registration_ref, 'public.customer_registrations'::regclass) t;
  IF v_err IS NOT NULL THEN RETURN v_err || jsonb_build_object('operation','reject_airtel_registration'); END IF;

  v_fp := wam_ai.registration_action_fingerprint(v_reg_id, 'reject_airtel_registration', p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key, 'reject_airtel_registration', v_fp);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status','error','operation','reject_airtel_registration',
      'error_category','idempotency_conflict','message','Idempotency key reused with different target');
  END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true,'operation','reject_airtel_registration',
      'status', CASE WHEN v_existing.outcome='success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT r.status INTO v_prev FROM public.customer_registrations r WHERE r.id = v_reg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','operation','reject_airtel_registration','error_category','not_found');
  END IF;
  IF NULLIF(btrim(p_expected_registration_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','expected_registration_status is required');
  END IF;
  IF v_prev IS DISTINCT FROM p_expected_registration_status THEN
    RETURN jsonb_build_object('status','error','operation','reject_airtel_registration',
      'error_category','expected_state_conflict','previous_registration_status',v_prev);
  END IF;
  IF v_prev = 'rejected' THEN
    v_result := jsonb_build_object('status','success','operation','reject_airtel_registration','already_completed',true,
      'registration_ref',wam_ai.registration_ref(v_reg_id),'previous_registration_status',v_prev,'resulting_registration_status','rejected',
      'financial_effect',jsonb_build_object('changed',false),'audit_reference',p_correlation_id::text);
    INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,registration_ref,outcome,result_payload)
    VALUES (p_idempotency_key,'reject_airtel_registration',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.registration_ref(v_reg_id),'success',v_result);
    RETURN v_result;
  END IF;
  IF v_prev <> 'pending' THEN
    RETURN jsonb_build_object('status','error','operation','reject_airtel_registration','error_category','invalid_transition',
      'message','Only pending Airtel registrations can be rejected','previous_registration_status',v_prev);
  END IF;

  UPDATE public.customer_registrations SET status = 'rejected', updated_at = now() WHERE id = v_reg_id;
  v_result := jsonb_build_object('status','success','operation','reject_airtel_registration','idempotent_replay',false,
    'registration_ref',wam_ai.registration_ref(v_reg_id),'product','airtel',
    'previous_registration_status',v_prev,'resulting_registration_status','rejected',
    'notification_summary', jsonb_build_object(
      'type','REGISTRATION_STATUS_CHANGE',
      'created', (SELECT wam_ai._notification_row_created(r.agent_id,'REGISTRATION_STATUS_CHANGE', clock_timestamp() - interval '2 seconds') FROM public.customer_registrations r WHERE r.id = v_reg_id),
      'source', CASE WHEN (SELECT wam_ai._notification_row_created(r.agent_id,'REGISTRATION_STATUS_CHANGE', clock_timestamp() - interval '2 seconds') FROM public.customer_registrations r WHERE r.id = v_reg_id) THEN 'database_trigger' ELSE 'none' END,
      'push_delivery','not_sent_from_rpc'),
    'financial_effect',jsonb_build_object('changed',false),'audit_reference',p_correlation_id::text,'correlation_id',p_correlation_id);

  INSERT INTO wam_ai.action_events (correlation_id,idempotency_key,actor_id,actor_role,operation_name,registration_ref,
    previous_registration_status,resulting_registration_status,outcome)
  VALUES (p_correlation_id,p_idempotency_key,p_actor_id,p_actor_role,'reject_airtel_registration',
    wam_ai.registration_ref(v_reg_id),v_prev,'rejected','success');
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,registration_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'reject_airtel_registration',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.registration_ref(v_reg_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

-- Similar pattern for mark_airtel_registration_duplicate, cancel_airtel_registration, confirm_airtel_registration_installation
-- Safaricom equivalents

CREATE OR REPLACE FUNCTION wam_ai.mark_airtel_registration_duplicate(
  p_registration_id uuid DEFAULT NULL, p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_registration_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE v_reg_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE; v_prev text; v_result jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL OR NULLIF(btrim(p_actor_id),'') IS NULL OR NULLIF(btrim(p_actor_role),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','mark_airtel_registration_duplicate','error_category','validation');
  END IF;
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN
    RETURN jsonb_build_object('status','error','operation','mark_airtel_registration_duplicate','error_category','action_not_authorized');
  END IF;
  SELECT t.v_registration_id, t.v_error INTO v_reg_id, v_err FROM wam_ai._resolve_registration_id(p_registration_id,p_registration_ref,'public.customer_registrations'::regclass) t;
  IF v_err IS NOT NULL THEN RETURN v_err || jsonb_build_object('operation','mark_airtel_registration_duplicate'); END IF;
  v_fp := wam_ai.registration_action_fingerprint(v_reg_id,'mark_airtel_registration_duplicate',p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key,'mark_airtel_registration_duplicate',v_fp);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('status','error','operation','mark_airtel_registration_duplicate','error_category','idempotency_conflict'); END;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true,'operation','mark_airtel_registration_duplicate','status','success'); END IF;
  SELECT r.status INTO v_prev FROM public.customer_registrations r WHERE r.id=v_reg_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','operation','mark_airtel_registration_duplicate'); END IF;
  IF NULLIF(btrim(p_expected_registration_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','expected_registration_status is required');
  END IF;
  IF v_prev IS DISTINCT FROM p_expected_registration_status THEN
    RETURN jsonb_build_object('status','error','operation','mark_airtel_registration_duplicate','error_category','expected_state_conflict','previous_registration_status',v_prev); END IF;
  IF v_prev='duplicate' THEN RETURN jsonb_build_object('status','success','operation','mark_airtel_registration_duplicate','already_completed',true,'registration_ref',wam_ai.registration_ref(v_reg_id)); END IF;
  IF v_prev<>'pending' THEN RETURN jsonb_build_object('status','error','operation','mark_airtel_registration_duplicate','error_category','invalid_transition','previous_registration_status',v_prev); END IF;
  UPDATE public.customer_registrations SET status='duplicate', updated_at=now() WHERE id=v_reg_id;
  v_result := jsonb_build_object('status','success','operation','mark_airtel_registration_duplicate','registration_ref',wam_ai.registration_ref(v_reg_id),
    'product','airtel','previous_registration_status',v_prev,'resulting_registration_status','duplicate',
    'financial_effect',jsonb_build_object('changed',false),'audit_reference',p_correlation_id::text);
  INSERT INTO wam_ai.action_events (correlation_id,idempotency_key,actor_id,actor_role,operation_name,registration_ref,previous_registration_status,resulting_registration_status,outcome)
  VALUES (p_correlation_id,p_idempotency_key,p_actor_id,p_actor_role,'mark_airtel_registration_duplicate',wam_ai.registration_ref(v_reg_id),v_prev,'duplicate','success');
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,registration_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'mark_airtel_registration_duplicate',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.registration_ref(v_reg_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.cancel_airtel_registration(
  p_registration_id uuid DEFAULT NULL, p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_registration_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE v_reg_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE; v_prev text; v_result jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL OR NULLIF(btrim(p_actor_id),'') IS NULL OR NULLIF(btrim(p_actor_role),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','cancel_airtel_registration','error_category','validation'); END IF;
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN
    RETURN jsonb_build_object('status','error','operation','cancel_airtel_registration','error_category','action_not_authorized'); END IF;
  SELECT t.v_registration_id, t.v_error INTO v_reg_id, v_err FROM wam_ai._resolve_registration_id(p_registration_id,p_registration_ref,'public.customer_registrations'::regclass) t;
  IF v_err IS NOT NULL THEN RETURN v_err || jsonb_build_object('operation','cancel_airtel_registration'); END IF;
  v_fp := wam_ai.registration_action_fingerprint(v_reg_id,'cancel_airtel_registration',p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key,'cancel_airtel_registration',v_fp);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('status','error','operation','cancel_airtel_registration','error_category','idempotency_conflict'); END;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true,'operation','cancel_airtel_registration','status','success'); END IF;
  SELECT r.status INTO v_prev FROM public.customer_registrations r WHERE r.id=v_reg_id FOR UPDATE;
  IF NULLIF(btrim(p_expected_registration_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','cancel_airtel_registration','error_category','validation','message','expected_registration_status is required');
  END IF;
  IF v_prev IS DISTINCT FROM p_expected_registration_status THEN
    RETURN jsonb_build_object('status','error','operation','cancel_airtel_registration','error_category','expected_state_conflict','previous_registration_status',v_prev);
  END IF;
  IF v_prev='cancelled' THEN RETURN jsonb_build_object('status','success','operation','cancel_airtel_registration','already_completed',true); END IF;
  IF v_prev<>'pending' THEN RETURN jsonb_build_object('status','error','operation','cancel_airtel_registration','error_category','invalid_transition','previous_registration_status',v_prev); END IF;
  UPDATE public.customer_registrations SET status='cancelled', updated_at=now() WHERE id=v_reg_id;
  v_result := jsonb_build_object('status','success','operation','cancel_airtel_registration','registration_ref',wam_ai.registration_ref(v_reg_id),
    'previous_registration_status',v_prev,'resulting_registration_status','cancelled','financial_effect',jsonb_build_object('changed',false),'audit_reference',p_correlation_id::text);
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,registration_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'cancel_airtel_registration',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.registration_ref(v_reg_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.confirm_airtel_registration_installation(
  p_registration_id uuid DEFAULT NULL, p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_registration_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_reg_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE;
  v_prev text; v_agent_id uuid; v_result jsonb; v_balance_before numeric; v_balance_after numeric;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL OR NULLIF(btrim(p_actor_id),'') IS NULL OR NULLIF(btrim(p_actor_role),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','confirm_airtel_registration_installation','error_category','validation'); END IF;
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN
    RETURN jsonb_build_object('status','error','operation','confirm_airtel_registration_installation','error_category','action_not_authorized'); END IF;
  SELECT t.v_registration_id, t.v_error INTO v_reg_id, v_err FROM wam_ai._resolve_registration_id(p_registration_id,p_registration_ref,'public.customer_registrations'::regclass) t;
  IF v_err IS NOT NULL THEN RETURN v_err || jsonb_build_object('operation','confirm_airtel_registration_installation'); END IF;
  v_fp := wam_ai.registration_action_fingerprint(v_reg_id,'confirm_airtel_registration_installation',p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key,'confirm_airtel_registration_installation',v_fp);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('status','error','operation','confirm_airtel_registration_installation','error_category','idempotency_conflict'); END;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true,'operation','confirm_airtel_registration_installation','status','success'); END IF;

  SELECT r.status, r.agent_id INTO v_prev, v_agent_id FROM public.customer_registrations r WHERE r.id=v_reg_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','operation','confirm_airtel_registration_installation'); END IF;
  IF NULLIF(btrim(p_expected_registration_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','expected_registration_status is required');
  END IF;
  IF v_prev IS DISTINCT FROM p_expected_registration_status THEN
    RETURN jsonb_build_object('status','error','operation','confirm_airtel_registration_installation','error_category','expected_state_conflict','previous_registration_status',v_prev); END IF;
  IF v_prev = 'installed' THEN
    RETURN jsonb_build_object('status','success','operation','confirm_airtel_registration_installation','already_completed',true,
      'registration_ref',wam_ai.registration_ref(v_reg_id),'resulting_registration_status','installed',
      'financial_effect',jsonb_build_object('changed',false,'reason','already_installed'),'audit_reference',p_correlation_id::text); END IF;
  IF v_prev <> 'pending' THEN
    RETURN jsonb_build_object('status','error','operation','confirm_airtel_registration_installation','error_category','invalid_transition','previous_registration_status',v_prev); END IF;

  SELECT a.available_balance INTO v_balance_before FROM public.agents a WHERE a.id = v_agent_id;
  UPDATE public.customer_registrations SET status = 'installed', updated_at = now() WHERE id = v_reg_id;
  SELECT a.available_balance INTO v_balance_after FROM public.agents a WHERE a.id = v_agent_id;

  v_result := jsonb_build_object('status','success','operation','confirm_airtel_registration_installation','idempotent_replay',false,
    'registration_ref',wam_ai.registration_ref(v_reg_id),'product','airtel',
    'previous_registration_status',v_prev,'resulting_registration_status','installed',
    'notification_summary', jsonb_build_object(
      'type','REGISTRATION_STATUS_CHANGE',
      'created', (SELECT wam_ai._notification_row_created(r.agent_id,'REGISTRATION_STATUS_CHANGE', clock_timestamp() - interval '2 seconds') FROM public.customer_registrations r WHERE r.id = v_reg_id),
      'source', CASE WHEN (SELECT wam_ai._notification_row_created(r.agent_id,'REGISTRATION_STATUS_CHANGE', clock_timestamp() - interval '2 seconds') FROM public.customer_registrations r WHERE r.id = v_reg_id) THEN 'database_trigger' ELSE 'none' END,
      'push_delivery','not_sent_from_rpc'),
    'financial_effect',jsonb_build_object(
      'changed', coalesce(v_balance_before,0) IS DISTINCT FROM coalesce(v_balance_after,0),
      'kind', 'airtel_earnings_recalculation',
      'agent_balance_before', coalesce(v_balance_before,0), 'agent_balance_after', coalesce(v_balance_after,0),
      'note', 'Balance change driven by recalculate_agent_airtel_earnings trigger when bound in production'
    ),'audit_reference',p_correlation_id::text,'correlation_id',p_correlation_id);

  INSERT INTO wam_ai.action_events (correlation_id,idempotency_key,actor_id,actor_role,operation_name,registration_ref,previous_registration_status,resulting_registration_status,outcome)
  VALUES (p_correlation_id,p_idempotency_key,p_actor_id,p_actor_role,'confirm_airtel_registration_installation',wam_ai.registration_ref(v_reg_id),v_prev,'installed','success');
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,registration_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'confirm_airtel_registration_installation',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.registration_ref(v_reg_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

-- Safaricom (no earnings trigger in admin-dashboard repo; operational status only)
CREATE OR REPLACE FUNCTION wam_ai.reject_safaricom_registration(
  p_registration_id uuid DEFAULT NULL, p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_registration_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE v_reg_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE; v_prev text; v_result jsonb;
BEGIN
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN RETURN jsonb_build_object('status','error','error_category','action_not_authorized'); END IF;
  SELECT t.v_registration_id, t.v_error INTO v_reg_id, v_err FROM wam_ai._resolve_registration_id(p_registration_id,p_registration_ref,'public.safaricom_registrations'::regclass) t;
  IF v_err IS NOT NULL THEN RETURN v_err || jsonb_build_object('operation','reject_safaricom_registration'); END IF;
  v_fp := wam_ai.registration_action_fingerprint(v_reg_id,'reject_safaricom_registration',p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key,'reject_safaricom_registration',v_fp); EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status','error','error_category','idempotency_conflict'); END;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true,'status','success'); END IF;
  SELECT r.status INTO v_prev FROM public.safaricom_registrations r WHERE r.id=v_reg_id FOR UPDATE;
  IF NULLIF(btrim(p_expected_registration_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','reject_safaricom_registration','error_category','validation','message','expected_registration_status is required');
  END IF;
  IF v_prev IS DISTINCT FROM p_expected_registration_status THEN
    RETURN jsonb_build_object('status','error','operation','reject_safaricom_registration','error_category','expected_state_conflict','previous_registration_status',v_prev);
  END IF;
  IF v_prev = 'rejected' THEN
    RETURN jsonb_build_object('status','success','operation','reject_safaricom_registration','already_completed',true,
      'registration_ref',wam_ai.registration_ref(v_reg_id),'resulting_registration_status','rejected',
      'financial_effect',jsonb_build_object('changed',false));
  END IF;
  IF v_prev <> 'pending' THEN
    RETURN jsonb_build_object('status','error','operation','reject_safaricom_registration','error_category','invalid_transition','previous_registration_status',v_prev);
  END IF;
  UPDATE public.safaricom_registrations SET status='rejected', updated_at=now() WHERE id=v_reg_id;
  v_result := jsonb_build_object('status','success','operation','reject_safaricom_registration','product','safaricom',
    'registration_ref',wam_ai.registration_ref(v_reg_id),'previous_registration_status',v_prev,'resulting_registration_status','rejected',
    'financial_effect',jsonb_build_object('changed',false),'audit_reference',p_correlation_id::text);
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,registration_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'reject_safaricom_registration',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.registration_ref(v_reg_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.mark_safaricom_registration_duplicate(
  p_registration_id uuid DEFAULT NULL, p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_registration_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE v_reg_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE; v_prev text; v_result jsonb;
BEGIN
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN RETURN jsonb_build_object('status','error','error_category','action_not_authorized'); END IF;
  SELECT t.v_registration_id, t.v_error INTO v_reg_id, v_err FROM wam_ai._resolve_registration_id(p_registration_id,p_registration_ref,'public.safaricom_registrations'::regclass) t;
  IF v_err IS NOT NULL THEN RETURN v_err; END IF;
  v_fp := wam_ai.registration_action_fingerprint(v_reg_id,'mark_safaricom_registration_duplicate',p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key,'mark_safaricom_registration_duplicate',v_fp); EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status','error','error_category','idempotency_conflict'); END;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true); END IF;
  SELECT r.status INTO v_prev FROM public.safaricom_registrations r WHERE r.id=v_reg_id FOR UPDATE;
  IF NULLIF(btrim(p_expected_registration_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','expected_registration_status is required');
  END IF;
  IF v_prev IS DISTINCT FROM p_expected_registration_status THEN
    RETURN jsonb_build_object('status','error','error_category','expected_state_conflict','previous_registration_status',v_prev);
  END IF;
  IF v_prev<>'pending' THEN RETURN jsonb_build_object('status','error','error_category','invalid_transition'); END IF;
  UPDATE public.safaricom_registrations SET status='duplicate', updated_at=now() WHERE id=v_reg_id;
  v_result := jsonb_build_object('status','success','operation','mark_safaricom_registration_duplicate','product','safaricom',
    'registration_ref',wam_ai.registration_ref(v_reg_id),'resulting_registration_status','duplicate','financial_effect',jsonb_build_object('changed',false));
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,registration_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'mark_safaricom_registration_duplicate',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.registration_ref(v_reg_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.cancel_safaricom_registration(
  p_registration_id uuid DEFAULT NULL, p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_registration_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE v_reg_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE; v_prev text; v_result jsonb;
BEGIN
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN RETURN jsonb_build_object('status','error','error_category','action_not_authorized'); END IF;
  SELECT t.v_registration_id, t.v_error INTO v_reg_id, v_err FROM wam_ai._resolve_registration_id(p_registration_id,p_registration_ref,'public.safaricom_registrations'::regclass) t;
  IF v_err IS NOT NULL THEN RETURN v_err; END IF;
  v_fp := wam_ai.registration_action_fingerprint(v_reg_id,'cancel_safaricom_registration',p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key,'cancel_safaricom_registration',v_fp); EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status','error','error_category','idempotency_conflict'); END;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true); END IF;
  SELECT r.status INTO v_prev FROM public.safaricom_registrations r WHERE r.id=v_reg_id FOR UPDATE;
  IF NULLIF(btrim(p_expected_registration_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','expected_registration_status is required');
  END IF;
  IF v_prev IS DISTINCT FROM p_expected_registration_status THEN
    RETURN jsonb_build_object('status','error','error_category','expected_state_conflict','previous_registration_status',v_prev);
  END IF;
  IF v_prev<>'pending' THEN RETURN jsonb_build_object('status','error','error_category','invalid_transition'); END IF;
  UPDATE public.safaricom_registrations SET status='cancelled', updated_at=now() WHERE id=v_reg_id;
  v_result := jsonb_build_object('status','success','operation','cancel_safaricom_registration','product','safaricom',
    'registration_ref',wam_ai.registration_ref(v_reg_id),'resulting_registration_status','cancelled','financial_effect',jsonb_build_object('changed',false));
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,registration_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'cancel_safaricom_registration',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.registration_ref(v_reg_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.confirm_safaricom_registration_installation(
  p_registration_id uuid DEFAULT NULL, p_registration_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_registration_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE v_reg_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE; v_prev text; v_result jsonb;
BEGIN
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN RETURN jsonb_build_object('status','error','error_category','action_not_authorized'); END IF;
  SELECT t.v_registration_id, t.v_error INTO v_reg_id, v_err FROM wam_ai._resolve_registration_id(p_registration_id,p_registration_ref,'public.safaricom_registrations'::regclass) t;
  IF v_err IS NOT NULL THEN RETURN v_err; END IF;
  v_fp := wam_ai.registration_action_fingerprint(v_reg_id,'confirm_safaricom_registration_installation',p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key,'confirm_safaricom_registration_installation',v_fp); EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('status','error','error_category','idempotency_conflict'); END;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true); END IF;
  SELECT r.status INTO v_prev FROM public.safaricom_registrations r WHERE r.id=v_reg_id FOR UPDATE;
  IF NULLIF(btrim(p_expected_registration_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','expected_registration_status is required');
  END IF;
  IF v_prev IS DISTINCT FROM p_expected_registration_status THEN
    RETURN jsonb_build_object('status','error','error_category','expected_state_conflict','previous_registration_status',v_prev);
  END IF;
  IF v_prev='installed' THEN RETURN jsonb_build_object('status','success','already_completed',true,'financial_effect',jsonb_build_object('changed',false)); END IF;
  IF v_prev<>'pending' THEN RETURN jsonb_build_object('status','error','error_category','invalid_transition','previous_registration_status',v_prev); END IF;
  UPDATE public.safaricom_registrations SET status='installed', updated_at=now() WHERE id=v_reg_id;
  v_result := jsonb_build_object('status','success','operation','confirm_safaricom_registration_installation','product','safaricom',
    'registration_ref',wam_ai.registration_ref(v_reg_id),'previous_registration_status',v_prev,'resulting_registration_status','installed',
    'financial_effect',jsonb_build_object('changed',false,'note','No Safaricom earnings trigger found in admin-dashboard repository'),
    'audit_reference',p_correlation_id::text);
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,registration_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'confirm_safaricom_registration_installation',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.registration_ref(v_reg_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

DO $rev$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='wam_ai' AND p.proname LIKE '%registration%' AND p.proname NOT LIKE '\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wam_ai_business_readonly') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly', r.sig);
    END IF;
  END LOOP;
  REVOKE ALL ON FUNCTION wam_ai._resolve_registration_id(uuid,text,regclass) FROM PUBLIC, anon, authenticated;
END;
$rev$;
