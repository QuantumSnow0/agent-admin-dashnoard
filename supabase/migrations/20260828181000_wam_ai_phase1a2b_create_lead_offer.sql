-- =============================================================================
-- WAM APPS AI Phase 1A.2b — controlled lead offer creation
-- Mirrors admin-dashboard offerLeadToAgent() transactional sequence.
-- Does NOT set assigned_agent_id, accepted_at, or offer status accepted.
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai.create_lead_offer(
  p_lead_id uuid DEFAULT NULL,
  p_lead_ref text DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_actor_id text DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_instruction_summary text DEFAULT NULL,
  p_recommendation_id uuid DEFAULT NULL,
  p_expected_lead_status text DEFAULT NULL,
  p_expected_agent_available boolean DEFAULT NULL,
  p_expected_distance_km double precision DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_lead_id uuid := p_lead_id;
  v_agent_id uuid := p_agent_id;
  v_lead_ref text := NULLIF(btrim(p_lead_ref), '');
  v_agent_ref text := wam_ai.normalize_agent_business_ref(p_agent_business_id);
  v_summary text := left(coalesce(NULLIF(btrim(p_instruction_summary), ''), 'create_lead_offer'), 200);
  v_reason text := left(coalesce(NULLIF(btrim(p_reason), ''), ''), 200);
  v_fingerprint text;
  v_existing wam_ai.action_requests%ROWTYPE;
  v_lead record;
  v_agent record;
  v_ads record;
  v_prev_status text;
  v_offer_id uuid;
  v_offer_seq integer;
  v_expires_at timestamptz;
  v_timeout_min integer;
  v_distance_raw double precision;
  v_distance_round double precision;
  v_radius double precision;
  v_lead_lat double precision;
  v_lead_lng double precision;
  v_agent_lat double precision;
  v_agent_lng double precision;
  v_lead_pin_verified boolean;
  v_agent_pin_verified boolean;
  v_county text;
  v_town_county text;
  v_preview jsonb;
  v_google_place jsonb;
  v_now timestamptz := now();
  v_radius_exception boolean := false;
  v_agent_match_count integer;
  v_open_dispatch integer := 0;
  v_cap_enabled boolean;
  v_max_open integer;
  v_declined boolean := false;
  v_assigned_conflict boolean := false;
  v_notification_title text;
  v_notification_message text;
  v_result jsonb;
  v_offerable text[] := ARRAY['admin_queue','pending_dispatch','offered','needs_reassignment'];
BEGIN
  IF p_idempotency_key IS NULL OR p_correlation_id IS NULL
     OR NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'validation',
      'message', 'idempotency_key, correlation_id, actor_id and actor_role are required'
    );
  END IF;

  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'action_not_authorized',
      'message', 'Actor role not authorized for lead offer creation'
    );
  END IF;

  IF v_lead_id IS NULL AND v_lead_ref IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'validation', 'message', 'lead_id or lead_ref required'
    );
  END IF;
  IF v_agent_id IS NULL AND v_agent_ref IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'validation', 'message', 'agent_id or agent_business_id required'
    );
  END IF;

  IF v_lead_id IS NOT NULL AND v_lead_ref IS NOT NULL
     AND wam_ai.lead_ref(v_lead_id) <> v_lead_ref THEN
    RETURN jsonb_build_object(
      'status', 'ambiguous', 'operation', 'create_lead_offer',
      'error_category', 'ambiguous_match',
      'message', 'lead_id and lead_ref refer to different leads'
    );
  END IF;

  IF v_lead_id IS NULL THEN
    SELECT l.id INTO v_lead_id FROM public.inbound_leads l
    WHERE wam_ai.lead_ref(l.id) = v_lead_ref LIMIT 2;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'not_found', 'operation', 'create_lead_offer',
        'error_category', 'not_found', 'message', 'Lead not found');
    END IF;
    IF (SELECT count(*) FROM public.inbound_leads l WHERE wam_ai.lead_ref(l.id) = v_lead_ref) > 1 THEN
      RETURN jsonb_build_object('status', 'ambiguous', 'operation', 'create_lead_offer',
        'error_category', 'ambiguous_match', 'message', 'lead_ref matches multiple leads');
    END IF;
  END IF;

  IF v_agent_id IS NULL THEN
    IF v_agent_ref IS NULL THEN
      RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
        'error_category', 'validation',
        'message', 'Invalid agent_business_id; raw UUID strings are not accepted as safe references');
    END IF;
    SELECT count(*)::int INTO v_agent_match_count
    FROM public.agents a WHERE wam_ai.agent_business_id(a.id) = v_agent_ref;
    IF v_agent_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'operation', 'create_lead_offer',
        'error_category', 'not_found', 'message', 'Agent not found');
    END IF;
    IF v_agent_match_count > 1 THEN
      RETURN jsonb_build_object('status', 'ambiguous', 'operation', 'create_lead_offer',
        'error_category', 'ambiguous_match', 'message', 'agent_business_id matches multiple agents');
    END IF;
    SELECT a.id INTO v_agent_id FROM public.agents a
    WHERE wam_ai.agent_business_id(a.id) = v_agent_ref
    ORDER BY a.id LIMIT 1;
  END IF;

  IF v_agent_id IS NOT NULL AND v_agent_ref IS NOT NULL
     AND wam_ai.agent_business_id(v_agent_id) <> v_agent_ref THEN
    RETURN jsonb_build_object('status', 'ambiguous', 'operation', 'create_lead_offer',
      'error_category', 'ambiguous_match',
      'message', 'agent_id and agent_business_id refer to different agents');
  END IF;

  v_fingerprint := wam_ai.action_request_fingerprint(v_lead_id, v_agent_id, p_actor_id);

  SELECT * INTO v_existing
  FROM wam_ai.action_requests ar
  WHERE ar.idempotency_key = p_idempotency_key
    AND ar.operation_name = 'create_lead_offer'
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN
      RETURN jsonb_build_object(
        'status', 'error', 'operation', 'create_lead_offer',
        'error_category', 'idempotency_conflict',
        'message', 'Idempotency key reused with different actor, lead, or agent'
      );
    END IF;
    RETURN (v_existing.result_payload || jsonb_build_object(
      'status', CASE WHEN v_existing.outcome = 'success' THEN 'success' ELSE 'error' END,
      'idempotent_replay', true,
      'operation', 'create_lead_offer',
      'error_category', v_existing.error_category
    ));
  END IF;

  -- Serialize all offer creation for one lead (blocks concurrent different-key races).
  SELECT * INTO v_lead FROM public.inbound_leads l WHERE l.id = v_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', 'create_lead_offer',
      'error_category', 'not_found', 'message', 'Lead not found');
  END IF;

  v_prev_status := v_lead.status;

  IF NOT (v_lead.status = ANY (v_offerable)) THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'lead_state_changed',
      'message', 'Lead status does not allow offer creation',
      'lead_ref', wam_ai.lead_ref(v_lead_id),
      'previous_lead_status', v_prev_status);
  END IF;

  IF v_lead.assigned_agent_id IS NOT NULL
     AND v_lead.status IN ('assigned', 'kyc_in_progress', 'kyc_completed', 'pending_install') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'lead_already_assigned',
      'message', 'Lead is already assigned',
      'lead_ref', wam_ai.lead_ref(v_lead_id));
  END IF;

  IF p_expected_lead_status IS NOT NULL AND v_lead.status IS DISTINCT FROM p_expected_lead_status THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'stale_recommendation',
      'message', 'Lead status changed since recommendation',
      'lead_ref', wam_ai.lead_ref(v_lead_id),
      'previous_lead_status', v_prev_status);
  END IF;

  v_timeout_min := wam_ai.offer_timeout_minutes();
  IF wam_ai.has_valid_active_offer(v_lead_id, v_timeout_min) THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'active_offer_exists',
      'message', 'Lead already has an active offer',
      'lead_ref', wam_ai.lead_ref(v_lead_id));
  END IF;

  SELECT a.id, a.name, a.status, a.lead_dispatch_scope, a.working_place, a.town
  INTO v_agent
  FROM public.agents a WHERE a.id = v_agent_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'operation', 'create_lead_offer',
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;

  IF v_agent.status <> 'approved' THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'agent_ineligible',
      'message', 'Agent is not approved',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  IF NOT wam_ai.agent_accepts_product(v_agent.lead_dispatch_scope, v_lead.product) THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'agent_ineligible',
      'message', 'Agent dispatch scope does not match lead product',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  SELECT ads.is_available, ads.service_radius_km, ads.county
  INTO v_ads
  FROM public.agent_dispatch_settings ads WHERE ads.agent_id = v_agent_id;

  IF NOT coalesce(v_ads.is_available, false) THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'agent_unavailable',
      'message', 'Agent is not currently available',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  IF p_expected_agent_available IS TRUE AND NOT coalesce(v_ads.is_available, false) THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'stale_recommendation',
      'message', 'Agent availability changed since recommendation',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.lead_offers o
    WHERE o.lead_id = v_lead_id AND o.agent_id = v_agent_id AND o.status = 'declined'
  ) INTO v_declined;

  IF v_declined THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'agent_ineligible',
      'message', 'Agent previously declined this lead',
      'agent_business_id', wam_ai.agent_business_id(v_agent_id));
  END IF;

  SELECT coalesce((dc.max_open_leads_enabled)::boolean, true),
         coalesce(dc.max_open_leads_per_agent, 3)
  INTO v_cap_enabled, v_max_open
  FROM public.dispatch_config dc ORDER BY dc.id LIMIT 1;

  IF v_cap_enabled THEN
    SELECT count(*)::int INTO v_open_dispatch
    FROM public.inbound_leads l
    WHERE l.assigned_agent_id = v_agent_id
      AND l.status IN ('assigned', 'kyc_in_progress', 'kyc_completed', 'pending_install');
    IF v_open_dispatch >= v_max_open THEN
      RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
        'error_category', 'capacity_reached',
        'message', 'Agent has reached open lead capacity',
        'agent_business_id', wam_ai.agent_business_id(v_agent_id));
    END IF;
  END IF;

  SELECT c.lat, c.lng, c.place_verified INTO v_lead_lat, v_lead_lng, v_lead_pin_verified
  FROM wam_ai.parse_lead_google_place_coords(v_lead.metadata) c;

  SELECT c.lat, c.lng, c.place_verified INTO v_agent_lat, v_agent_lng, v_agent_pin_verified
  FROM wam_ai.parse_working_place_coords(v_agent.working_place) c;

  v_radius := wam_ai.effective_service_radius_km(
    v_ads.service_radius_km,
    coalesce((SELECT default_service_radius_km FROM public.dispatch_config ORDER BY id LIMIT 1), 8)::numeric
  )::double precision;

  IF v_lead_pin_verified AND v_agent_pin_verified THEN
    v_distance_raw := wam_ai.haversine_km(v_lead_lat, v_lead_lng, v_agent_lat, v_agent_lng);
    v_distance_round := round(v_distance_raw::numeric, 1)::double precision;
    v_radius_exception := v_distance_raw > v_radius;
  ELSE
    v_distance_raw := NULL;
    v_distance_round := NULL;
  END IF;

  IF p_expected_distance_km IS NOT NULL AND v_distance_round IS NOT NULL
     AND abs(v_distance_round - p_expected_distance_km) > 0.5 THEN
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'stale_recommendation',
      'message', 'Verified distance changed materially since recommendation',
      'lead_ref', wam_ai.lead_ref(v_lead_id),
      'distance_km', v_distance_round);
  END IF;

  v_google_place := CASE
    WHEN v_lead.metadata IS NOT NULL AND jsonb_typeof(v_lead.metadata) = 'object'
      THEN v_lead.metadata->'googlePlace' ELSE NULL END;

  -- Customer county only (mirrors offerLeadToAgent: googlePlace → town → existing lead).
  -- Agent dispatch county/town must never be written as customer county.
  v_town_county := NULL;
  IF to_regclass('public.location_reference') IS NOT NULL
     AND NULLIF(btrim(v_lead.installation_town), '') IS NOT NULL THEN
    SELECT lr.county INTO v_town_county
    FROM public.location_reference lr
    WHERE lower(btrim(lr.town_key)) = lower(btrim(v_lead.installation_town))
       OR lower(btrim(lr.town_label)) = lower(btrim(v_lead.installation_town))
    LIMIT 1;
  END IF;

  v_county := coalesce(
    NULLIF(btrim(v_google_place->>'county'), ''),
    NULLIF(btrim(v_town_county), ''),
    v_lead.county
  );

  v_preview := jsonb_build_object(
    'product', v_lead.product,
    'county', v_county,
    'agentOperatingCounty', v_ads.county,
    'installationTown', v_lead.installation_town,
    'roughArea', coalesce(v_lead.installation_area, v_lead.delivery_landmark),
    'packageLabel', coalesce(v_lead.plan_label, v_lead.preferred_package),
    'submittedAgoMinutes', greatest(0, floor(extract(epoch FROM (v_now - v_lead.created_at)) / 60.0))::int,
    'distanceKm', v_distance_round,
    'googlePlace', v_google_place
  );

  v_timeout_min := coalesce(
    (SELECT offer_timeout_minutes FROM public.dispatch_config ORDER BY id LIMIT 1),
    15
  );
  v_expires_at := v_now + make_interval(mins => greatest(v_timeout_min, 1));

  v_notification_title := CASE v_lead.product
    WHEN 'safaricom' THEN 'New Safaricom lead'
    ELSE 'New Airtel lead' END;
  v_notification_message := coalesce(v_lead.installation_town, 'Nearby');

  -- Atomic offer creation (mirrors offerLeadToAgent)
  UPDATE public.lead_offers
  SET status = 'superseded', responded_at = v_now
  WHERE lead_id = v_lead_id AND status = 'offered';

  SELECT coalesce(max(o.offer_sequence), 0) + 1 INTO v_offer_seq
  FROM public.lead_offers o WHERE o.lead_id = v_lead_id;

  INSERT INTO public.lead_offers (
    lead_id, agent_id, status, offer_sequence, distance_km,
    preview_payload, expires_at, metadata
  ) VALUES (
    v_lead_id, v_agent_id, 'offered', v_offer_seq, v_distance_raw,
    v_preview, v_expires_at,
    jsonb_build_object(
      'offered_by', 'wam_ai',
      'actor_role', p_actor_role,
      'recommendation_id', p_recommendation_id,
      'instruction_summary', v_summary,
      'reason', NULLIF(v_reason, '')
    )
  ) RETURNING id INTO v_offer_id;

  UPDATE public.inbound_leads
  SET status = 'offered',
      county = v_county,
      assigned_agent_id = NULL,
      accepted_at = NULL
  WHERE id = v_lead_id;

  INSERT INTO public.notifications (
    agent_id, type, title, message, related_id, metadata
  ) VALUES (
    v_agent_id,
    'LEAD_OFFER',
    v_notification_title,
    v_notification_message,
    v_lead_id,
    jsonb_build_object('offerId', v_offer_id, 'preview', v_preview)
  );

  v_result := jsonb_build_object(
    'status', 'success',
    'operation', 'create_lead_offer',
    'idempotent_replay', false,
    'offer_ref', wam_ai.offer_ref(v_offer_id),
    'lead_ref', wam_ai.lead_ref(v_lead_id),
    'agent_name', v_agent.name,
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'previous_lead_status', v_prev_status,
    'resulting_lead_status', 'offered',
    'offer_status', 'offered',
    'offer_expires_at', v_expires_at,
    'offer_timeout_minutes', v_timeout_min,
    'distance_km', v_distance_round,
    'configured_radius_km', round(v_radius::numeric, 1),
    'radius_exception_used', v_radius_exception,
    'revalidated_at', v_now,
    'agent_has_not_accepted', true,
    'expected_next_step', 'Agent must accept or decline the offer through the normal app workflow',
    'audit_reference', p_correlation_id::text,
    'correlation_id', p_correlation_id,
    'recommendation_id', p_recommendation_id
  );

  INSERT INTO wam_ai.action_events (
    correlation_id, idempotency_key, actor_id, actor_role, operation_name,
    lead_ref, agent_business_ref, previous_lead_status, resulting_lead_status,
    offer_ref, radius_exception_used, outcome, error_category
  ) VALUES (
    p_correlation_id, p_idempotency_key, p_actor_id, p_actor_role, 'create_lead_offer',
    wam_ai.lead_ref(v_lead_id), wam_ai.agent_business_id(v_agent_id),
    v_prev_status, 'offered', wam_ai.offer_ref(v_offer_id),
    v_radius_exception, 'success', NULL
  );

  INSERT INTO wam_ai.action_requests (
    idempotency_key, operation_name, correlation_id, actor_id, actor_role,
    request_fingerprint, lead_ref, agent_business_ref, outcome, error_category,
    offer_ref, result_payload
  ) VALUES (
    p_idempotency_key, 'create_lead_offer', p_correlation_id, p_actor_id, p_actor_role,
    v_fingerprint, wam_ai.lead_ref(v_lead_id), wam_ai.agent_business_id(v_agent_id),
    'success', NULL, wam_ai.offer_ref(v_offer_id), v_result
  );

  RETURN v_result;

EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM wam_ai.action_requests ar
    WHERE ar.idempotency_key = p_idempotency_key
      AND ar.operation_name = 'create_lead_offer';
    IF FOUND THEN
      RETURN v_existing.result_payload || jsonb_build_object(
        'idempotent_replay', true, 'operation', 'create_lead_offer');
    END IF;
    RETURN jsonb_build_object('status', 'error', 'operation', 'create_lead_offer',
      'error_category', 'idempotency_conflict',
      'message', 'Concurrent idempotency conflict');
  WHEN OTHERS THEN
    RAISE;
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.create_lead_offer(
  uuid, text, uuid, text, uuid, uuid, text, text, text, uuid, text, boolean, double precision, text
) FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    REVOKE ALL ON FUNCTION wam_ai.create_lead_offer(
      uuid, text, uuid, text, uuid, uuid, text, text, text, uuid, text, boolean, double precision, text
    ) FROM wam_ai_business_readonly;
  END IF;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai' AND p.proname IN ('offer_ref', 'action_request_fingerprint', 'resolve_agent_id_from_business_ref')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_actions', r.sig);
    END IF;
  END LOOP;
END;
$priv$;

COMMENT ON FUNCTION wam_ai.create_lead_offer IS
  'MCP: wam.business.dispatch.create_lead_offer — creates a legitimate blind lead offer. Never assigns the lead.';

-- Production grant (apply manually after role creation):
-- GRANT EXECUTE ON FUNCTION wam_ai.create_lead_offer(uuid,text,uuid,text,uuid,uuid,text,text,text,uuid,text,boolean,double precision,text)
--   TO wam_ai_business_actions;
