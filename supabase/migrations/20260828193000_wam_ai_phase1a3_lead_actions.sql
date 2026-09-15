-- =============================================================================
-- WAM APPS AI Phase 1A.3 — inbound lead lifecycle actions
-- Conservative vs admin PATCH /api/admin/leads/[id]/status:
--   Admin does not mutate lead_offers. WAM refuses when an active offer exists.
--   Admin may null commission on terminal statuses. WAM refuses if commission is set.
-- revert_lead_pending_install: installed → pending_install only (financial).
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai._resolve_lead_for_action(
  p_lead_id uuid,
  p_lead_ref text,
  OUT v_lead_id uuid,
  OUT v_error jsonb
)
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_ref text := NULLIF(btrim(p_lead_ref), '');
  v_count integer;
BEGIN
  v_lead_id := p_lead_id;
  IF v_lead_id IS NULL AND v_ref IS NULL THEN
    v_error := jsonb_build_object('status','error','error_category','validation',
      'message','lead_id or lead_ref required');
    RETURN;
  END IF;
  IF v_lead_id IS NOT NULL AND v_ref IS NOT NULL AND wam_ai.lead_ref(v_lead_id) <> v_ref THEN
    v_error := jsonb_build_object('status','ambiguous','error_category','ambiguous_match',
      'message','lead_id and lead_ref refer to different leads');
    RETURN;
  END IF;
  IF v_lead_id IS NULL THEN
    SELECT count(*)::int INTO v_count FROM public.inbound_leads l WHERE wam_ai.lead_ref(l.id) = v_ref;
    IF v_count = 0 THEN v_error := jsonb_build_object('status','not_found','error_category','not_found','message','Lead not found'); RETURN; END IF;
    IF v_count > 1 THEN v_error := jsonb_build_object('status','ambiguous','error_category','ambiguous_match','message','lead_ref matches multiple leads'); RETURN; END IF;
    SELECT l.id INTO v_lead_id FROM public.inbound_leads l WHERE wam_ai.lead_ref(l.id) = v_ref LIMIT 1;
  END IF;
  v_error := NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.confirm_lead_installation(
  p_lead_id uuid DEFAULT NULL,
  p_lead_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_expected_lead_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_lead_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE;
  v_lead record; v_prev text; v_commission numeric; v_now timestamptz := now(); v_result jsonb;
  v_default_commission constant numeric := 200;
  v_active_offers integer := 0;
  v_notif_created boolean := false;
  v_commission_before numeric;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id),'') IS NULL OR NULLIF(btrim(p_actor_role),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','confirm_lead_installation','error_category','validation',
      'message','idempotency_key, correlation_id, actor_id and actor_role are required');
  END IF;
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN
    RETURN jsonb_build_object('status','error','operation','confirm_lead_installation','error_category','action_not_authorized');
  END IF;
  IF NULLIF(btrim(p_expected_lead_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','confirm_lead_installation','error_category','validation',
      'message','expected_lead_status is required');
  END IF;
  SELECT t.v_lead_id, t.v_error INTO v_lead_id, v_err FROM wam_ai._resolve_lead_for_action(p_lead_id, p_lead_ref) t;
  IF v_err IS NOT NULL THEN RETURN v_err || jsonb_build_object('operation','confirm_lead_installation'); END IF;
  v_fp := wam_ai.lead_status_action_fingerprint(v_lead_id,'confirm_lead_installation',p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key,'confirm_lead_installation',v_fp);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('status','error','operation','confirm_lead_installation','error_category','idempotency_conflict',
    'message','Idempotency key reused with different actor or target'); END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true,'operation','confirm_lead_installation',
      'status', CASE WHEN v_existing.outcome='success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT l.* INTO v_lead FROM public.inbound_leads l WHERE l.id = v_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','operation','confirm_lead_installation','error_category','not_found'); END IF;

  PERFORM 1 FROM public.lead_offers o WHERE o.lead_id = v_lead_id AND o.status = 'offered' FOR UPDATE;
  SELECT count(*)::int INTO v_active_offers FROM public.lead_offers o WHERE o.lead_id = v_lead_id AND o.status = 'offered';
  IF v_active_offers > 0 THEN
    RETURN jsonb_build_object('status','error','operation','confirm_lead_installation','error_category','active_offer_exists',
      'message','Lead has an active offer; resolve the offer before confirming installation','lead_ref',wam_ai.lead_ref(v_lead_id));
  END IF;

  v_prev := v_lead.status;
  v_commission_before := v_lead.commission_earned_ksh;
  IF v_prev IS DISTINCT FROM p_expected_lead_status THEN
    RETURN jsonb_build_object('status','error','operation','confirm_lead_installation','error_category','expected_state_conflict',
      'previous_lead_status',v_prev,'message','Lead status changed since preview');
  END IF;
  IF v_prev = 'installed' THEN
    v_result := jsonb_build_object('status','success','operation','confirm_lead_installation','already_completed',true,
      'lead_ref',wam_ai.lead_ref(v_lead_id),'previous_lead_status',v_prev,'resulting_lead_status','installed',
      'commission_kes',coalesce(v_lead.commission_earned_ksh,v_default_commission),
      'financial_effect',jsonb_build_object('changed',false,'kind','lead_install_commission_accrual',
        'commission_before',v_commission_before,'commission_after',v_lead.commission_earned_ksh),
      'notification_summary',jsonb_build_object('created',false,'reason','already_installed','push_delivery','not_sent_from_rpc'),
      'audit_reference',p_correlation_id::text,'correlation_id',p_correlation_id,'action_reference',p_idempotency_key::text);
    INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,lead_ref,outcome,result_payload)
    VALUES (p_idempotency_key,'confirm_lead_installation',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.lead_ref(v_lead_id),'success',v_result);
    RETURN v_result;
  END IF;
  IF v_prev NOT IN ('pending_install','kyc_completed') THEN
    RETURN jsonb_build_object('status','error','operation','confirm_lead_installation','error_category','invalid_transition',
      'message','Lead must be pending_install or kyc_completed','previous_lead_status',v_prev);
  END IF;

  v_commission := CASE WHEN coalesce(v_lead.commission_earned_ksh,0) > 0 THEN v_lead.commission_earned_ksh ELSE v_default_commission END;
  UPDATE public.inbound_leads SET
    status = 'installed',
    installed_at = coalesce(v_lead.installed_at, v_now),
    commission_earned_ksh = v_commission,
    metadata = coalesce(v_lead.metadata,'{}'::jsonb) || jsonb_build_object(
      'installCommission', jsonb_build_object(
        'amountKes', v_commission, 'confirmedAt', v_now, 'confirmedBy', 'wam_ai',
        'proofReference', CASE WHEN v_lead.product='airtel' THEN NULLIF(btrim(v_lead.airtel_sr_number),'')
          ELSE NULLIF(btrim(v_lead.safaricom_imei),'') END
      )
    )
  WHERE id = v_lead_id;

  IF v_lead.assigned_agent_id IS NOT NULL THEN
    INSERT INTO public.notifications (agent_id, type, title, message, related_id, metadata)
    VALUES (
      v_lead.assigned_agent_id, 'LEAD_INSTALLED', 'Installation confirmed',
      format('Admin confirmed install. Commission KSh %s will be paid with your next payout.', v_commission),
      v_lead_id,
      jsonb_build_object('leadId', v_lead_id, 'commissionKes', v_commission, 'product', v_lead.product, 'source', 'wam_ai')
    );
    v_notif_created := true;
  END IF;

  v_result := jsonb_build_object('status','success','operation','confirm_lead_installation','idempotent_replay',false,
    'lead_ref',wam_ai.lead_ref(v_lead_id),'previous_lead_status',v_prev,'resulting_lead_status','installed',
    'commission_kes', v_commission,
    'assigned_agent_cleared', false,
    'notification_summary', jsonb_build_object(
      'type','LEAD_INSTALLED','created', v_notif_created, 'source', CASE WHEN v_notif_created THEN 'rpc_insert' ELSE 'none' END,
      'push_delivery','not_sent_from_rpc'),
    'financial_effect', jsonb_build_object(
      'changed', v_commission_before IS DISTINCT FROM v_commission,
      'kind', 'lead_install_commission_accrual',
      'commission_before', v_commission_before, 'commission_after', v_commission, 'amount_kes', v_commission,
      'note','Commission recorded on lead row; payout via agent_payments remains separate'),
    'audit_reference', p_correlation_id::text, 'correlation_id', p_correlation_id,
    'action_reference', p_idempotency_key::text);

  INSERT INTO wam_ai.action_events (correlation_id,idempotency_key,actor_id,actor_role,operation_name,lead_ref,previous_lead_status,resulting_lead_status,outcome)
  VALUES (p_correlation_id,p_idempotency_key,p_actor_id,p_actor_role,'confirm_lead_installation',wam_ai.lead_ref(v_lead_id),v_prev,'installed','success');
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,lead_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'confirm_lead_installation',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.lead_ref(v_lead_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._mark_lead_terminal_status(
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
  v_lead_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE;
  v_lead record; v_prev text; v_result jsonb; v_active_offers integer := 0;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id),'') IS NULL OR NULLIF(btrim(p_actor_role),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation',p_operation,'error_category','validation',
      'message','idempotency_key, correlation_id, actor_id and actor_role are required');
  END IF;
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN
    RETURN jsonb_build_object('status','error','operation',p_operation,'error_category','action_not_authorized');
  END IF;
  IF NULLIF(btrim(p_expected_lead_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation',p_operation,'error_category','validation',
      'message','expected_lead_status is required');
  END IF;
  SELECT t.v_lead_id, t.v_error INTO v_lead_id, v_err FROM wam_ai._resolve_lead_for_action(p_lead_id, p_lead_ref) t;
  IF v_err IS NOT NULL THEN RETURN v_err || jsonb_build_object('operation',p_operation); END IF;
  v_fp := wam_ai.lead_status_action_fingerprint(v_lead_id, p_operation, p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key, p_operation, v_fp);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('status','error','operation',p_operation,'error_category','idempotency_conflict',
    'message','Idempotency key reused with different actor or target'); END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true,'operation',p_operation,
      'status', CASE WHEN v_existing.outcome='success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT l.* INTO v_lead FROM public.inbound_leads l WHERE l.id = v_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','operation',p_operation,'error_category','not_found'); END IF;

  PERFORM 1 FROM public.lead_offers o WHERE o.lead_id = v_lead_id AND o.status = 'offered' FOR UPDATE;
  SELECT count(*)::int INTO v_active_offers FROM public.lead_offers o WHERE o.lead_id = v_lead_id AND o.status = 'offered';
  IF v_active_offers > 0 THEN
    RETURN jsonb_build_object('status','error','operation',p_operation,'error_category','active_offer_exists',
      'message','Lead has an active offer; use a dedicated offer-resolution action first',
      'lead_ref',wam_ai.lead_ref(v_lead_id),'active_offer_count',v_active_offers);
  END IF;

  v_prev := v_lead.status;
  IF v_prev IS DISTINCT FROM p_expected_lead_status THEN
    RETURN jsonb_build_object('status','error','operation',p_operation,'error_category','expected_state_conflict',
      'previous_lead_status',v_prev,'message','Lead status changed since preview');
  END IF;
  IF v_prev = p_target_status THEN
    v_result := jsonb_build_object('status','success','operation',p_operation,'already_completed',true,
      'lead_ref',wam_ai.lead_ref(v_lead_id),'previous_lead_status',v_prev,'resulting_lead_status',p_target_status,
      'financial_effect',jsonb_build_object('changed',false),
      'notification_summary',jsonb_build_object('created',false),
      'audit_reference',p_correlation_id::text,'action_reference',p_idempotency_key::text);
    INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,lead_ref,outcome,result_payload)
    VALUES (p_idempotency_key,p_operation,p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.lead_ref(v_lead_id),'success',v_result);
    RETURN v_result;
  END IF;
  IF v_prev = 'installed' THEN
    RETURN jsonb_build_object('status','error','operation',p_operation,'error_category','invalid_transition',
      'message','Cannot change status of an installed lead via this action');
  END IF;
  IF NOT (v_prev = ANY (p_allowed_from)) THEN
    RETURN jsonb_build_object('status','error','operation',p_operation,'error_category','invalid_transition','previous_lead_status',v_prev);
  END IF;
  IF v_lead.commission_earned_ksh IS NOT NULL THEN
    RETURN jsonb_build_object('status','error','operation',p_operation,'error_category','commission_present',
      'message','Lead has commission recorded; refuse silent clearing. Use a financial correction action.',
      'financial_effect',jsonb_build_object('changed',false,'commission_before',v_lead.commission_earned_ksh));
  END IF;

  -- Canonical admin PATCH updates status only (does not clear assigned_agent_id or mutate offers).
  UPDATE public.inbound_leads SET status = p_target_status WHERE id = v_lead_id;

  v_result := jsonb_build_object('status','success','operation',p_operation,'idempotent_replay',false,
    'lead_ref',wam_ai.lead_ref(v_lead_id),
    'previous_lead_status',v_prev,'resulting_lead_status',p_target_status,
    'assigned_agent_cleared', false,
    'active_offers_resolved', false,
    'financial_effect',jsonb_build_object('changed',false,'commission_before',NULL,'commission_after',NULL),
    'notification_summary',jsonb_build_object('created',false,'push_delivery','not_sent_from_rpc'),
    'audit_reference',p_correlation_id::text,'correlation_id',p_correlation_id,
    'action_reference',p_idempotency_key::text);
  INSERT INTO wam_ai.action_events (correlation_id,idempotency_key,actor_id,actor_role,operation_name,lead_ref,previous_lead_status,resulting_lead_status,outcome)
  VALUES (p_correlation_id,p_idempotency_key,p_actor_id,p_actor_role,p_operation,wam_ai.lead_ref(v_lead_id),v_prev,p_target_status,'success');
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,lead_ref,outcome,result_payload)
  VALUES (p_idempotency_key,p_operation,p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.lead_ref(v_lead_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

-- offered is excluded: active_offer_exists is required instead of mutating offers.
CREATE OR REPLACE FUNCTION wam_ai.mark_lead_rejected(
  p_lead_id uuid DEFAULT NULL, p_lead_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_lead_status text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT wam_ai._mark_lead_terminal_status('mark_lead_rejected','rejected',p_lead_id,p_lead_ref,p_idempotency_key,p_correlation_id,p_actor_id,p_actor_role,p_expected_lead_status,
    ARRAY['assigned','kyc_in_progress','kyc_completed','pending_install','admin_queue','needs_reassignment','pending_dispatch']);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.mark_lead_duplicate(
  p_lead_id uuid DEFAULT NULL, p_lead_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_lead_status text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT wam_ai._mark_lead_terminal_status('mark_lead_duplicate','duplicate',p_lead_id,p_lead_ref,p_idempotency_key,p_correlation_id,p_actor_id,p_actor_role,p_expected_lead_status,
    ARRAY['assigned','kyc_in_progress','kyc_completed','pending_install','admin_queue','needs_reassignment','pending_dispatch']);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.mark_lead_cancelled(
  p_lead_id uuid DEFAULT NULL, p_lead_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_lead_status text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT wam_ai._mark_lead_terminal_status('mark_lead_cancelled','cancelled',p_lead_id,p_lead_ref,p_idempotency_key,p_correlation_id,p_actor_id,p_actor_role,p_expected_lead_status,
    ARRAY['assigned','kyc_in_progress','kyc_completed','pending_install','admin_queue','needs_reassignment','pending_dispatch','deferred']);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.mark_lead_lost(
  p_lead_id uuid DEFAULT NULL, p_lead_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_lead_status text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT wam_ai._mark_lead_terminal_status('mark_lead_lost','lost',p_lead_id,p_lead_ref,p_idempotency_key,p_correlation_id,p_actor_id,p_actor_role,p_expected_lead_status,
    ARRAY['assigned','kyc_in_progress','kyc_completed','pending_install','admin_queue','needs_reassignment','pending_dispatch','deferred']);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.mark_lead_needs_reassignment(
  p_lead_id uuid DEFAULT NULL, p_lead_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_lead_status text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT wam_ai._mark_lead_terminal_status('mark_lead_needs_reassignment','needs_reassignment',p_lead_id,p_lead_ref,p_idempotency_key,p_correlation_id,p_actor_id,p_actor_role,p_expected_lead_status,
    ARRAY['assigned','kyc_in_progress','kyc_completed','pending_install','deferred']);
$fn$;

-- Canonical proven source: admin PATCH pending_install clears commission when correcting an install.
-- Agent workflow sets pending_install from kyc_completed (not a revert). Rejected/duplicate/cancelled/lost
-- are not a proven dedicated revert path — refuse those.
CREATE OR REPLACE FUNCTION wam_ai.revert_lead_pending_install(
  p_lead_id uuid DEFAULT NULL, p_lead_ref text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL, p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL, p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL, p_expected_lead_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_lead_id uuid; v_err jsonb; v_fp text; v_existing wam_ai.action_requests%ROWTYPE;
  v_lead record; v_prev text; v_result jsonb; v_active_offers integer := 0;
  v_commission_before numeric;
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id),'') IS NULL OR NULLIF(btrim(p_actor_role),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','revert_lead_pending_install','error_category','validation',
      'message','idempotency_key, correlation_id, actor_id and actor_role are required');
  END IF;
  IF p_actor_role NOT IN ('technical_owner','business_partner') THEN
    RETURN jsonb_build_object('status','error','operation','revert_lead_pending_install','error_category','action_not_authorized');
  END IF;
  IF NULLIF(btrim(p_expected_lead_status),'') IS NULL THEN
    RETURN jsonb_build_object('status','error','operation','revert_lead_pending_install','error_category','validation',
      'message','expected_lead_status is required');
  END IF;
  SELECT t.v_lead_id, t.v_error INTO v_lead_id, v_err FROM wam_ai._resolve_lead_for_action(p_lead_id,p_lead_ref) t;
  IF v_err IS NOT NULL THEN RETURN v_err || jsonb_build_object('operation','revert_lead_pending_install'); END IF;
  v_fp := wam_ai.lead_status_action_fingerprint(v_lead_id,'revert_lead_pending_install',p_actor_id);
  BEGIN SELECT * INTO v_existing FROM wam_ai._agent_idempotency_begin(p_idempotency_key,'revert_lead_pending_install',v_fp);
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('status','error','operation','revert_lead_pending_install','error_category','idempotency_conflict',
    'message','Idempotency key reused with different actor or target'); END;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.result_payload || jsonb_build_object('idempotent_replay',true,'operation','revert_lead_pending_install',
      'status', CASE WHEN v_existing.outcome='success' THEN 'success' ELSE 'error' END);
  END IF;

  SELECT l.* INTO v_lead FROM public.inbound_leads l WHERE l.id = v_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','operation','revert_lead_pending_install','error_category','not_found'); END IF;

  PERFORM 1 FROM public.lead_offers o WHERE o.lead_id = v_lead_id AND o.status = 'offered' FOR UPDATE;
  SELECT count(*)::int INTO v_active_offers FROM public.lead_offers o WHERE o.lead_id = v_lead_id AND o.status = 'offered';
  IF v_active_offers > 0 THEN
    RETURN jsonb_build_object('status','error','operation','revert_lead_pending_install','error_category','active_offer_exists');
  END IF;

  v_prev := v_lead.status;
  v_commission_before := v_lead.commission_earned_ksh;
  IF v_prev IS DISTINCT FROM p_expected_lead_status THEN
    RETURN jsonb_build_object('status','error','operation','revert_lead_pending_install','error_category','expected_state_conflict',
      'previous_lead_status',v_prev);
  END IF;
  IF v_prev = 'pending_install' THEN
    v_result := jsonb_build_object('status','success','operation','revert_lead_pending_install','already_completed',true,
      'lead_ref',wam_ai.lead_ref(v_lead_id),'previous_lead_status',v_prev,'resulting_lead_status','pending_install',
      'financial_effect',jsonb_build_object('changed',false,'commission_before',v_commission_before,'commission_after',v_commission_before),
      'notification_summary',jsonb_build_object('created',false),
      'audit_reference',p_correlation_id::text,'action_reference',p_idempotency_key::text);
    INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,lead_ref,outcome,result_payload)
    VALUES (p_idempotency_key,'revert_lead_pending_install',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.lead_ref(v_lead_id),'success',v_result);
    RETURN v_result;
  END IF;
  IF v_prev <> 'installed' THEN
    RETURN jsonb_build_object('status','error','operation','revert_lead_pending_install','error_category','invalid_transition',
      'message','Only an installed inbound lead may be reverted to pending_install',
      'previous_lead_status',v_prev);
  END IF;

  UPDATE public.inbound_leads SET status='pending_install', commission_earned_ksh=NULL, installed_at=NULL WHERE id=v_lead_id;

  v_result := jsonb_build_object('status','success','operation','revert_lead_pending_install','idempotent_replay',false,
    'lead_ref',wam_ai.lead_ref(v_lead_id),
    'previous_lead_status',v_prev,'resulting_lead_status','pending_install',
    'assigned_agent_cleared', false,
    'financial_effect',jsonb_build_object(
      'changed', v_commission_before IS NOT NULL,
      'kind','lead_install_commission_clear',
      'commission_before', v_commission_before,
      'commission_after', NULL
    ),
    'notification_summary',jsonb_build_object('created',false,'push_delivery','not_sent_from_rpc'),
    'audit_reference',p_correlation_id::text,'correlation_id',p_correlation_id,
    'action_reference',p_idempotency_key::text);
  INSERT INTO wam_ai.action_events (correlation_id,idempotency_key,actor_id,actor_role,operation_name,lead_ref,previous_lead_status,resulting_lead_status,outcome)
  VALUES (p_correlation_id,p_idempotency_key,p_actor_id,p_actor_role,'revert_lead_pending_install',wam_ai.lead_ref(v_lead_id),v_prev,'pending_install','success');
  INSERT INTO wam_ai.action_requests (idempotency_key,operation_name,correlation_id,actor_id,actor_role,request_fingerprint,lead_ref,outcome,result_payload)
  VALUES (p_idempotency_key,'revert_lead_pending_install',p_correlation_id,p_actor_id,p_actor_role,v_fp,wam_ai.lead_ref(v_lead_id),'success',v_result);
  RETURN v_result;
END;
$fn$;

DO $rev$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='wam_ai' AND p.proname IN (
      'confirm_lead_installation','mark_lead_rejected','mark_lead_duplicate','mark_lead_cancelled',
      'mark_lead_lost','mark_lead_needs_reassignment','revert_lead_pending_install',
      '_resolve_lead_for_action','_mark_lead_terminal_status'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wam_ai_business_readonly') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly', r.sig);
    END IF;
  END LOOP;
END;
$rev$;
