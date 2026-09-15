-- =============================================================================
-- WAM APPS AI Phase 1A.2a — read-only lead-to-agent recommendations
-- Additive only. No business-table writes. No assignment or offer creation.
-- Mirrors dispatch eligibility from admin-dashboard/lib/dispatch/matching.ts
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Haversine distance (km) — matches admin-dashboard/lib/dispatch/geo.ts (R=6371)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.haversine_km(
  p_lat1 double precision,
  p_lon1 double precision,
  p_lat2 double precision,
  p_lon2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN p_lat1 IS NULL OR p_lon1 IS NULL OR p_lat2 IS NULL OR p_lon2 IS NULL THEN NULL
    WHEN NOT (
      p_lat1 BETWEEN -90 AND 90 AND p_lat2 BETWEEN -90 AND 90
      AND p_lon1 BETWEEN -180 AND 180 AND p_lon2 BETWEEN -180 AND 180
    ) THEN NULL
    ELSE (
      6371.0 * 2 * atan2(
        sqrt(
          power(sin(radians(p_lat2 - p_lat1) / 2.0), 2)
          + cos(radians(p_lat1)) * cos(radians(p_lat2))
            * power(sin(radians(p_lon2 - p_lon1) / 2.0), 2)
        ),
        sqrt(
          greatest(
            1e-12,
            1.0 - (
              power(sin(radians(p_lat2 - p_lat1) / 2.0), 2)
              + cos(radians(p_lat1)) * cos(radians(p_lat2))
                * power(sin(radians(p_lon2 - p_lon1) / 2.0), 2)
            )
          )
        )
      )
    )
  END;
$fn$;

COMMENT ON FUNCTION wam_ai.haversine_km IS
  'Straight-line km between two WGS84 points. Same formula as lib/dispatch/geo.ts distanceKm().';

-- ---------------------------------------------------------------------------
-- Parse customer/agent Google Place pin from JSONB (parsePreviewGooglePlace)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.parse_working_place_coords(p_place jsonb)
RETURNS TABLE(lat double precision, lng double precision, place_verified boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_lat double precision;
  v_lng double precision;
  v_place_id text;
  v_name text;
BEGIN
  IF p_place IS NULL OR jsonb_typeof(p_place) <> 'object' THEN
    lat := NULL; lng := NULL; place_verified := false; RETURN NEXT; RETURN;
  END IF;
  v_place_id := NULLIF(btrim(p_place->>'placeId'), '');
  v_name := NULLIF(btrim(p_place->>'name'), '');
  BEGIN
    v_lat := (p_place->>'lat')::double precision;
    v_lng := (p_place->>'lng')::double precision;
  EXCEPTION WHEN others THEN
    lat := NULL; lng := NULL; place_verified := false; RETURN NEXT; RETURN;
  END;
  IF v_place_id IS NULL OR v_name IS NULL
     OR v_lat IS NULL OR v_lng IS NULL
     OR NOT (v_lat BETWEEN -90 AND 90 AND v_lng BETWEEN -180 AND 180) THEN
    lat := NULL; lng := NULL; place_verified := false; RETURN NEXT; RETURN;
  END IF;
  lat := v_lat; lng := v_lng; place_verified := true; RETURN NEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.parse_lead_google_place_coords(p_metadata jsonb)
RETURNS TABLE(lat double precision, lng double precision, place_verified boolean)
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT c.lat, c.lng, c.place_verified
  FROM wam_ai.parse_working_place_coords(
    CASE WHEN p_metadata IS NOT NULL AND jsonb_typeof(p_metadata) = 'object'
      THEN p_metadata->'googlePlace' ELSE NULL END
  ) c;
$fn$;

-- ---------------------------------------------------------------------------
-- Product scope — agentAcceptsProduct() in matching.ts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.agent_accepts_product(p_scope text, p_product text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN coalesce(p_scope, 'none') = 'none' THEN false
    WHEN p_scope = 'both' THEN true
    ELSE p_scope = p_product
  END;
$fn$;

-- ---------------------------------------------------------------------------
-- Effective radius — effectiveRadiusKm() / clampServiceRadiusKm()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.effective_service_radius_km(
  p_agent_override numeric,
  p_default numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN p_agent_override IS NOT NULL AND p_agent_override::double precision > 0 THEN
      LEAST(50.0, GREATEST(0.5, p_agent_override::double precision))
    ELSE
      LEAST(50.0, GREATEST(0.5, coalesce(p_default::double precision, 8.0)))
  END;
$fn$;

-- ---------------------------------------------------------------------------
-- Online presence — isAgentOnline() in matching.ts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.is_agent_online(
  p_last_seen_at timestamptz,
  p_presence_minutes integer
) RETURNS boolean
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT p_last_seen_at IS NOT NULL
    AND p_last_seen_at <= now()
    AND p_last_seen_at >= now() - make_interval(mins => greatest(coalesce(p_presence_minutes, 5), 1));
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.clamp_recommend_limit(p_limit integer)
RETURNS integer
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT LEAST(GREATEST(coalesce(p_limit, 10), 1), 25);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.clamp_performance_window_days(p_days integer)
RETURNS integer
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT LEAST(GREATEST(coalesce(p_days, 30), 7), 90);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.load_dispatch_snapshot()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT coalesce(
    (
      SELECT jsonb_build_object(
        'default_service_radius_km',
          coalesce(dc.default_service_radius_km::double precision, 8.0),
        'online_presence_minutes',
          coalesce(dc.online_presence_minutes, 5),
        'max_open_leads_enabled',
          coalesce(dc.max_open_leads_enabled, true),
        'max_open_leads_per_agent',
          coalesce(dc.max_open_leads_per_agent, 3),
        'dispatch_enabled',
          coalesce(dc.dispatch_enabled, true),
        'offer_timeout_minutes',
          coalesce(dc.offer_timeout_minutes, 10)
      )
      FROM public.dispatch_config dc
      ORDER BY dc.id
      LIMIT 1
    ),
    jsonb_build_object(
      'default_service_radius_km', 8.0,
      'online_presence_minutes', 5,
      'max_open_leads_enabled', true,
      'max_open_leads_per_agent', 3,
      'dispatch_enabled', true,
      'offer_timeout_minutes', 10
    )
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Geographic practicality — evidence-based; no fixed universal max distance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.geographic_practicality_label(
  p_lead_verified boolean,
  p_agent_verified boolean,
  p_distance_km double precision,
  p_effective_radius_km double precision,
  p_closer_eligible_count integer,
  p_min_closer_distance_km double precision,
  p_is_top_recommendation boolean
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN NOT p_lead_verified OR NOT p_agent_verified OR p_distance_km IS NULL THEN
      'distance_unverified'
    WHEN p_distance_km <= p_effective_radius_km THEN
      'inside_normal_radius'
    WHEN p_closer_eligible_count > 0
      AND p_min_closer_distance_km IS NOT NULL
      AND p_distance_km > (p_min_closer_distance_km * 2.0 + p_effective_radius_km) THEN
      'operationally_impractical'
    WHEN p_is_top_recommendation THEN
      'outside_normal_radius_but_recommended'
    ELSE
      'outside_normal_radius_alternative'
  END;
$fn$;

-- ---------------------------------------------------------------------------
-- Lead recommendable? (assignment-attention statuses)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.lead_recommendation_compatible(p_lead_id uuid)
RETURNS TABLE(
  compatible boolean,
  reason text,
  status text,
  assigned_agent_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_status text;
  v_assigned uuid;
  v_timeout integer := wam_ai.offer_timeout_minutes();
BEGIN
  SELECT l.status, l.assigned_agent_id INTO v_status, v_assigned
  FROM public.inbound_leads l WHERE l.id = p_lead_id;
  IF NOT FOUND THEN
    compatible := false; reason := 'lead_not_found'; status := NULL; assigned_agent_id := NULL;
    RETURN NEXT; RETURN;
  END IF;
  status := v_status; assigned_agent_id := v_assigned;
  IF v_assigned IS NOT NULL AND v_status IN ('assigned', 'kyc_in_progress', 'kyc_completed', 'pending_install') THEN
    compatible := false; reason := 'lead_already_assigned'; RETURN NEXT; RETURN;
  END IF;
  IF v_status IN ('installed', 'lost', 'expired', 'cancelled', 'rejected', 'duplicate', 'deferred') THEN
    compatible := false; reason := 'lead_status_' || v_status; RETURN NEXT; RETURN;
  END IF;
  IF v_status IN ('pending_dispatch', 'admin_queue', 'needs_reassignment') THEN
    compatible := true; reason := v_status; RETURN NEXT; RETURN;
  END IF;
  IF v_status = 'offered' AND NOT wam_ai.has_valid_active_offer(p_lead_id, v_timeout) THEN
    compatible := true; reason := 'offered_without_valid_active_offer'; RETURN NEXT; RETURN;
  END IF;
  IF v_status = 'offered' THEN
    compatible := false; reason := 'lead_has_active_offer'; RETURN NEXT; RETURN;
  END IF;
  compatible := false; reason := 'lead_status_' || coalesce(v_status, 'unknown'); RETURN NEXT;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Main recommendation RPC (read-only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.recommend_agents_for_lead(
  p_lead_id uuid DEFAULT NULL,
  p_lead_ref text DEFAULT NULL,
  p_limit integer DEFAULT NULL,
  p_include_unavailable boolean DEFAULT false,
  p_include_ineligible_diagnostics boolean DEFAULT false,
  p_performance_window_days integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_lead_id uuid := p_lead_id;
  v_ref text := NULLIF(btrim(p_lead_ref), '');
  v_limit integer := wam_ai.clamp_recommend_limit(p_limit);
  v_perf_days integer := wam_ai.clamp_performance_window_days(p_performance_window_days);
  v_perf_from timestamptz := now() - make_interval(days => v_perf_days);
  v_config jsonb := wam_ai.load_dispatch_snapshot();
  v_default_radius double precision := (v_config->>'default_service_radius_km')::double precision;
  v_presence_minutes integer := (v_config->>'online_presence_minutes')::integer;
  v_cap_enabled boolean := coalesce((v_config->>'max_open_leads_enabled')::boolean, true);
  v_max_open integer := coalesce((v_config->>'max_open_leads_per_agent')::integer, 3);
  v_lead record;
  v_compat record;
  v_lead_lat double precision;
  v_lead_lng double precision;
  v_lead_pin_verified boolean;
  v_lead_waiting_hours double precision;
  v_lead_urgency text;
  v_candidates jsonb := '[]'::jsonb;
  v_diagnostics jsonb := '[]'::jsonb;
  v_row jsonb;
  v_agent record;
  v_agent_lat double precision;
  v_agent_lng double precision;
  v_agent_pin_verified boolean;
  v_distance_raw double precision;
  v_distance_round double precision;
  v_effective_radius double precision;
  v_hard_eligible boolean;
  v_currently_recommendable boolean;
  v_unavailable_diagnostics jsonb := '[]'::jsonb;
  v_inclusion jsonb;
  v_exclusion jsonb;
  v_open_dispatch integer;
  v_open_broad integer;
  v_active_offers integer;
  v_declined boolean;
  v_assigned_conflict boolean;
  v_capacity_remaining integer;
  v_online boolean;
  v_scope_match boolean;
  v_existing_dispatch_sort double precision;
  v_balanced_score double precision;
  v_distance_penalty double precision;
  v_urgency_distance_relief double precision;
  v_recent_accepted integer;
  v_recent_registrations integer;
  v_recent_installs integer;
  v_recent_assignments integer;
  v_conversion_rate double precision;
  v_pending_regs integer;
  v_last_activity timestamptz;
  v_workload_warning text;
  v_distance_warning text;
  v_unknown_metrics jsonb;
  v_sorted jsonb;
  v_existing_ranked jsonb;
  v_balanced_ranked jsonb;
  v_recommendation_ranked jsonb;
  v_recommended jsonb;
  v_alternatives jsonb;
  v_closer_count integer := 0;
  v_min_closer_distance double precision;
  v_closer_reasons jsonb := '[]'::jsonb;
  v_radius_expansion boolean := false;
  v_rec_distance double precision;
  v_no_rec_reason text;
  v_mgmt_alternatives jsonb;
  v_recommendation_id uuid := gen_random_uuid();
  v_data_freshness timestamptz := now();
BEGIN
  IF v_lead_id IS NULL AND v_ref IS NULL THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;

  IF v_lead_id IS NOT NULL AND v_ref IS NOT NULL
     AND wam_ai.lead_ref(v_lead_id) <> v_ref THEN
    RETURN jsonb_build_object(
      'status', 'ambiguous',
      'match_count', 2,
      'message', 'lead_id and lead_ref refer to different leads',
      'error_category', 'ambiguous_match'
    );
  END IF;

  IF v_lead_id IS NULL AND v_ref IS NOT NULL THEN
    SELECT l.id INTO v_lead_id FROM public.inbound_leads l
    WHERE wam_ai.lead_ref(l.id) = v_ref LIMIT 1;
    IF v_lead_id IS NULL THEN
      RETURN jsonb_build_object(
        'status', 'not_found', 'match_count', 0,
        'message', 'Lead not found', 'error_category', 'not_found'
      );
    END IF;
  END IF;

  SELECT l.* INTO v_lead FROM public.inbound_leads l WHERE l.id = v_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'not_found', 'match_count', 0,
      'message', 'Lead not found', 'error_category', 'not_found'
    );
  END IF;

  SELECT * INTO v_compat FROM wam_ai.lead_recommendation_compatible(v_lead_id);
  IF NOT v_compat.compatible THEN
    RETURN jsonb_build_object(
      'status', 'incompatible',
      'recommendation_id', v_recommendation_id,
      'data_freshness_at', v_data_freshness,
      'lead', jsonb_build_object(
        'lead_id', v_lead_id,
        'lead_ref', wam_ai.lead_ref(v_lead_id),
        'status', v_compat.status,
        'product', v_lead.product,
        'county', v_lead.county,
        'installation_town', v_lead.installation_town,
        'assigned_agent_id', v_compat.assigned_agent_id,
        'lead_state_compatible', false,
        'incompatibility_reason', v_compat.reason
      ),
      'configured_radius_km', v_default_radius,
      'candidates', '[]'::jsonb,
      'recommended_agent', NULL,
      'alternative_agents', '[]'::jsonb,
      'no_recommendation_reason', v_compat.reason,
      'suggested_management_alternatives', jsonb_build_array(
        'Review lead status in admin dashboard',
        'Wait for offer expiry if an active offer exists',
        'Use manual admin assign when lead is in admin_queue'
      )
    );
  END IF;

  SELECT c.lat, c.lng, c.place_verified
  INTO v_lead_lat, v_lead_lng, v_lead_pin_verified
  FROM wam_ai.parse_lead_google_place_coords(v_lead.metadata) c;

  v_lead_waiting_hours := round(
    extract(epoch FROM (now() - v_lead.created_at)) / 3600.0, 2
  );

  v_lead_urgency := CASE
    WHEN v_lead_waiting_hours >= 72 THEN 'high'
    WHEN v_lead_waiting_hours >= 24 THEN 'elevated'
    WHEN v_lead_waiting_hours >= 8 THEN 'moderate'
    ELSE 'normal'
  END;

  FOR v_agent IN
    SELECT
      a.id,
      a.name,
      a.town,
      a.area,
      a.status,
      a.lead_dispatch_scope,
      a.working_place,
      coalesce(a.is_fallback_agent, false) AS is_fallback_agent,
      coalesce(a.fallback_priority, 100) AS fallback_priority,
      ads.is_available,
      ads.county AS dispatch_county,
      ads.last_seen_at,
      ads.service_radius_km
    FROM public.agents a
    LEFT JOIN public.agent_dispatch_settings ads ON ads.agent_id = a.id
    WHERE a.status = 'approved'
       OR p_include_ineligible_diagnostics
  LOOP
    SELECT c.lat, c.lng, c.place_verified
    INTO v_agent_lat, v_agent_lng, v_agent_pin_verified
    FROM wam_ai.parse_working_place_coords(v_agent.working_place) c;

    v_distance_raw := CASE
      WHEN v_lead_pin_verified AND v_agent_pin_verified THEN
        wam_ai.haversine_km(v_lead_lat, v_lead_lng, v_agent_lat, v_agent_lng)
      ELSE NULL
    END;
    v_distance_round := CASE
      WHEN v_distance_raw IS NULL THEN NULL
      ELSE round(v_distance_raw::numeric, 1)::double precision
    END;

    v_effective_radius := wam_ai.effective_service_radius_km(
      v_agent.service_radius_km, v_default_radius::numeric
    )::double precision;

    v_scope_match := wam_ai.agent_accepts_product(
      v_agent.lead_dispatch_scope, v_lead.product
    );

    v_online := wam_ai.is_agent_online(v_agent.last_seen_at, v_presence_minutes);

    SELECT count(*)::int INTO v_open_dispatch
    FROM public.inbound_leads l
    WHERE l.assigned_agent_id = v_agent.id
      AND l.status IN ('assigned', 'kyc_in_progress', 'kyc_completed');

    SELECT count(*)::int INTO v_open_broad
    FROM public.inbound_leads l
    WHERE l.assigned_agent_id = v_agent.id
      AND l.status NOT IN ('installed', 'lost', 'expired');

    SELECT count(*)::int INTO v_active_offers
    FROM public.lead_offers o
    WHERE o.agent_id = v_agent.id AND o.status = 'offered';

    SELECT EXISTS (
      SELECT 1 FROM public.lead_offers o
      WHERE o.lead_id = v_lead_id AND o.agent_id = v_agent.id AND o.status = 'declined'
    ) INTO v_declined;

    SELECT EXISTS (
      SELECT 1 FROM public.inbound_leads l
      WHERE l.id = v_lead_id AND l.assigned_agent_id = v_agent.id
        AND l.status IN ('assigned', 'kyc_in_progress', 'kyc_completed', 'pending_install')
    ) INTO v_assigned_conflict;

    v_capacity_remaining := CASE
      WHEN NOT v_cap_enabled THEN NULL
      ELSE greatest(0, v_max_open - v_open_dispatch)
    END;

    v_inclusion := '[]'::jsonb;
    v_exclusion := '[]'::jsonb;
    v_unknown_metrics := '[]'::jsonb;

    IF v_agent.status = 'approved' THEN
      v_inclusion := v_inclusion || jsonb_build_array('account_approved');
    ELSE
      v_exclusion := v_exclusion || jsonb_build_array('not_approved');
    END IF;

    IF v_scope_match THEN
      v_inclusion := v_inclusion || jsonb_build_array('product_scope_match');
    ELSE
      v_exclusion := v_exclusion || jsonb_build_array('dispatch_scope_mismatch');
    END IF;

    IF coalesce(v_agent.is_available, false) THEN
      v_inclusion := v_inclusion || jsonb_build_array('available');
    ELSE
      v_exclusion := v_exclusion || jsonb_build_array('not_available');
    END IF;

    IF v_declined THEN
      v_exclusion := v_exclusion || jsonb_build_array('declined_this_lead');
    END IF;

    IF v_assigned_conflict THEN
      v_exclusion := v_exclusion || jsonb_build_array('already_assigned_this_lead');
    END IF;

    IF v_cap_enabled AND v_open_dispatch >= v_max_open THEN
      v_exclusion := v_exclusion || jsonb_build_array('open_lead_cap_reached');
    END IF;

    IF NOT v_lead_pin_verified THEN
      v_unknown_metrics := v_unknown_metrics || jsonb_build_array('lead_coordinates');
    END IF;

    IF NOT v_agent_pin_verified THEN
      v_unknown_metrics := v_unknown_metrics || jsonb_build_array('agent_working_pin');
    END IF;

    v_hard_eligible :=
      v_agent.status = 'approved'
      AND v_scope_match
      AND NOT v_declined
      AND NOT v_assigned_conflict
      AND (NOT v_cap_enabled OR v_open_dispatch < v_max_open);

    v_currently_recommendable :=
      v_hard_eligible AND coalesce(v_agent.is_available, false);

    IF NOT v_hard_eligible AND NOT p_include_ineligible_diagnostics THEN
      CONTINUE;
    END IF;

    IF NOT v_currently_recommendable
       AND NOT p_include_unavailable
       AND NOT p_include_ineligible_diagnostics THEN
      CONTINUE;
    END IF;

    -- Performance window metrics (distinct business meanings)
    SELECT count(*)::int INTO v_recent_accepted
    FROM public.lead_offers o
    WHERE o.agent_id = v_agent.id AND o.status = 'accepted'
      AND o.responded_at >= v_perf_from;

    SELECT count(*)::int INTO v_recent_assignments
    FROM public.inbound_leads l
    WHERE l.assigned_agent_id = v_agent.id
      AND l.accepted_at >= v_perf_from;

    SELECT count(*)::int INTO v_recent_registrations
    FROM public.customer_registrations cr
    WHERE cr.agent_id = v_agent.id AND cr.created_at >= v_perf_from;

    SELECT count(*)::int INTO v_recent_installs
    FROM public.customer_registrations cr
    WHERE cr.agent_id = v_agent.id AND cr.status = 'installed'
      AND cr.updated_at >= v_perf_from;
    -- Note: updated_at is last registration touch, not a verified installation event time.

    SELECT count(*)::int INTO v_pending_regs
    FROM public.customer_registrations cr
    WHERE cr.agent_id = v_agent.id
      AND cr.status NOT IN ('installed', 'cancelled', 'rejected');

    v_conversion_rate := CASE
      WHEN v_recent_accepted IS NULL OR v_recent_accepted = 0 THEN NULL
      WHEN (
        SELECT count(*)::int FROM public.lead_offers o
        WHERE o.agent_id = v_agent.id
          AND o.status IN ('accepted', 'declined', 'expired')
          AND o.responded_at >= v_perf_from
      ) = 0 THEN NULL
      ELSE round(
        v_recent_accepted::numeric
        / nullif((
          SELECT count(*)::int FROM public.lead_offers o
          WHERE o.agent_id = v_agent.id
            AND o.status IN ('accepted', 'declined', 'expired')
            AND o.responded_at >= v_perf_from
        ), 0)::numeric,
        3
      )::double precision
    END;

    v_last_activity := v_agent.last_seen_at;

    v_workload_warning := CASE
      WHEN v_cap_enabled AND v_open_dispatch >= v_max_open - 1 AND v_open_dispatch > 0
        THEN 'near_open_lead_cap'
      WHEN v_open_broad >= 5 THEN 'high_broad_workload'
      WHEN v_active_offers >= 2 THEN 'multiple_active_offers'
      ELSE NULL
    END;

    v_distance_warning := CASE
      WHEN v_distance_raw IS NULL THEN 'distance_unverified'
      WHEN v_distance_raw > v_effective_radius THEN 'outside_configured_radius'
      ELSE NULL
    END;

    -- Existing dispatch rank key (mirrors rankAgentsInRange + online preference)
    v_existing_dispatch_sort := CASE
      WHEN NOT v_hard_eligible THEN 999999.0
      WHEN NOT v_lead_pin_verified OR NOT v_agent_pin_verified THEN 999998.0
      WHEN v_distance_raw IS NULL THEN 999997.0
      WHEN v_distance_raw > v_effective_radius AND NOT v_agent.is_fallback_agent THEN 999996.0
      ELSE
        (CASE WHEN v_online THEN 0.0 ELSE 1000.0 END)
        + v_distance_raw
        + (CASE WHEN v_agent.is_fallback_agent THEN 5000.0 ELSE 0.0 END)
    END;

    -- Balanced business score (lower is better; continuous distance factor)
    v_distance_penalty := CASE
      WHEN v_distance_raw IS NULL THEN 75.0
      ELSE greatest(0.0, v_distance_raw - v_effective_radius) * 1.5
    END;

    v_balanced_score :=
      v_distance_penalty
      + (CASE WHEN NOT v_online THEN 12.0 ELSE 0.0 END)
      + (CASE WHEN NOT coalesce(v_agent.is_available, false) THEN 50.0 ELSE 0.0 END)
      + v_open_dispatch * 8.0
      + v_active_offers * 4.0
      - least(coalesce(v_recent_installs, 0), 5) * 2.0
      - least(coalesce(v_recent_accepted, 0), 5) * 1.0
      + (CASE
          WHEN v_distance_raw IS NOT NULL AND v_distance_raw > v_effective_radius
            THEN -5.0
          ELSE 0.0
        END);

    v_row := jsonb_build_object(
      'agent_id', v_agent.id,
      'agent_business_id', wam_ai.agent_business_id(v_agent.id),
      'agent_name', v_agent.name,
      'county', coalesce(v_agent.dispatch_county, v_agent.town),
      'town', v_agent.town,
      'area', v_agent.area,
      'hard_eligible', v_hard_eligible,
      'currently_recommendable', v_currently_recommendable,
      'eligibility_reasons', v_inclusion,
      'ineligibility_reasons', v_exclusion,
      'dispatch_scope_match', v_scope_match,
      'product_authorized', v_scope_match,
      'approval_status', v_agent.status,
      'dispatch_scope', v_agent.lead_dispatch_scope,
      'availability_status', CASE
        WHEN coalesce(v_agent.is_available, false) THEN 'available'
        ELSE 'unavailable'
      END,
      'online_status', CASE WHEN v_online THEN 'online' ELSE 'offline' END,
      'location_verifiable', v_agent_pin_verified,
      'existing_offer_conflict', v_declined OR v_assigned_conflict,
      'lead_state_compatible', true,
      'capacity_rule_enabled', v_cap_enabled,
      'capacity_remaining', v_capacity_remaining,
      'designated_fallback', v_agent.is_fallback_agent,
      'fallback_priority', v_agent.fallback_priority,
      'lead_location_verified', v_lead_pin_verified,
      'agent_location_verified', v_agent_pin_verified
    ) || jsonb_build_object(
      'distance_km', v_distance_round,
      'distance_km_raw', v_distance_raw,
      'configured_radius_km', round(v_effective_radius::numeric, 1),
      'inside_configured_radius', CASE
        WHEN v_distance_raw IS NULL THEN NULL
        ELSE v_distance_raw <= v_effective_radius
      END,
      'radius_expansion_required', CASE
        WHEN v_distance_raw IS NULL THEN NULL
        ELSE v_distance_raw > v_effective_radius
      END,
      'distance_penalty', round(v_distance_penalty::numeric, 2),
      'lead_location_source', CASE
        WHEN v_lead_pin_verified THEN 'metadata.googlePlace'
        ELSE NULL
      END,
      'agent_location_source', CASE
        WHEN v_agent_pin_verified THEN 'agents.working_place'
        ELSE NULL
      END,
      'location_data_quality', CASE
        WHEN v_lead_pin_verified AND v_agent_pin_verified THEN 'verified_pin_pair'
        WHEN NOT v_lead_pin_verified AND NOT v_agent_pin_verified THEN 'both_unverified'
        WHEN NOT v_lead_pin_verified THEN 'lead_pin_missing'
        ELSE 'agent_pin_missing'
      END,
      'open_active_leads', v_open_dispatch,
      'open_active_leads_broad', v_open_broad,
      'active_offer_count', v_active_offers,
      'recent_assignments', v_recent_assignments,
      'recent_accepted_offers', v_recent_accepted,
      'recent_registrations', v_recent_registrations,
      'recent_registrations_installed_touch', v_recent_installs,
      'recent_conversion_rate', v_conversion_rate,
      'pending_or_incomplete_registrations', v_pending_regs,
      'last_activity_at', v_last_activity,
      'performance_window_days', v_perf_days,
      'workload_warning', v_workload_warning,
      'distance_warning', v_distance_warning,
      'unknown_metrics', v_unknown_metrics
    ) || jsonb_build_object(
      'data_quality_warnings', CASE
        WHEN jsonb_array_length(v_unknown_metrics) > 0 THEN v_unknown_metrics
        ELSE '[]'::jsonb
      END,
      'existing_dispatch_sort_key', v_existing_dispatch_sort,
      'balanced_business_score', round(v_balanced_score::numeric, 3),
      'ranking_reasons', '[]'::jsonb,
      'ranking_penalties', '[]'::jsonb,
      'ranking_warnings', CASE
        WHEN v_workload_warning IS NOT NULL OR v_distance_warning IS NOT NULL THEN
          jsonb_build_array(
            to_jsonb(coalesce(v_workload_warning, v_distance_warning))
          )
        ELSE '[]'::jsonb
      END
    );

    IF v_currently_recommendable THEN
      v_candidates := v_candidates || jsonb_build_array(v_row);
    ELSIF v_hard_eligible AND NOT coalesce(v_agent.is_available, false) THEN
      v_row := v_row || jsonb_build_object(
        'unavailable_diagnostic', true,
        'not_ready_reason', 'agent_not_available',
        'recommendation_blocked_reason',
          'Agent is hard-eligible but not currently available; included for diagnostic comparison only.'
      );
      v_unavailable_diagnostics := v_unavailable_diagnostics || jsonb_build_array(v_row);
    ELSIF p_include_ineligible_diagnostics THEN
      v_diagnostics := v_diagnostics || jsonb_build_array(v_row);
    END IF;
  END LOOP;

  v_urgency_distance_relief := CASE v_lead_urgency
    WHEN 'high' THEN 0.45
    WHEN 'elevated' THEN 0.25
    WHEN 'moderate' THEN 0.10
    ELSE 0.0
  END;

  -- Count closer currently-recommendable agents with verified distance
  SELECT count(*)::int, min((c->>'distance_km_raw')::double precision)
  INTO v_closer_count, v_min_closer_distance
  FROM jsonb_array_elements(v_candidates) c
  WHERE (c->>'distance_km_raw') IS NOT NULL
    AND (c->>'distance_km_raw')::double precision IS NOT NULL;

  -- Existing dispatch ranking
  SELECT coalesce(jsonb_agg(elem ORDER BY sort_key, agent_id), '[]'::jsonb)
  INTO v_existing_ranked
  FROM (
    SELECT
      elem || jsonb_build_object(
        'existing_dispatch_rank',
        row_number() OVER (
          ORDER BY (elem->>'existing_dispatch_sort_key')::double precision,
                   elem->>'agent_id'
        )
      ) AS elem,
      (elem->>'existing_dispatch_sort_key')::double precision AS sort_key,
      elem->>'agent_id' AS agent_id
    FROM jsonb_array_elements(v_candidates) AS elem
    WHERE coalesce((elem->>'currently_recommendable')::boolean, false)
  ) s;

  -- Balanced business ranking (available + hard-eligible only)
  SELECT coalesce(jsonb_agg(elem ORDER BY score, agent_id), '[]'::jsonb)
  INTO v_balanced_ranked
  FROM (
    SELECT
      elem || jsonb_build_object(
        'balanced_business_rank',
        row_number() OVER (
          ORDER BY (elem->>'balanced_business_score')::double precision,
                   coalesce((elem->>'distance_km_raw')::double precision, 999999),
                   elem->>'agent_id'
        )
      ) AS elem,
      (elem->>'balanced_business_score')::double precision AS score,
      elem->>'agent_id' AS agent_id
    FROM jsonb_array_elements(v_candidates) AS elem
    WHERE coalesce((elem->>'currently_recommendable')::boolean, false)
  ) s;

  -- Recommendation rank: geo_label computed once in inner query, penalty applied in middle
  SELECT coalesce(jsonb_agg(ranked ORDER BY rec_rank), '[]'::jsonb)
  INTO v_recommendation_ranked
  FROM (
    SELECT
      s.elem || jsonb_build_object(
        'recommendation_rank', row_number() OVER (ORDER BY s.rec_sort, s.agent_id),
        'geographic_practicality', s.geo_label
      ) AS ranked,
      row_number() OVER (ORDER BY s.rec_sort, s.agent_id) AS rec_rank,
      s.rec_sort,
      s.agent_id
    FROM (
      SELECT
        g.elem,
        g.agent_id,
        g.geo_label,
        (
          (g.elem->>'balanced_business_score')::double precision
          + CASE
              WHEN (g.elem->>'distance_km_raw') IS NULL THEN 25.0
              WHEN (g.elem->>'inside_configured_radius')::boolean THEN -5.0
              ELSE 0.0
            END
          + CASE
              WHEN (g.elem->>'distance_km_raw') IS NOT NULL
                AND NOT coalesce((g.elem->>'inside_configured_radius')::boolean, false)
              THEN
                -greatest(
                  0.0,
                  (g.elem->>'distance_km_raw')::double precision
                    - (g.elem->>'configured_radius_km')::double precision
                ) * 1.5 * v_urgency_distance_relief
              ELSE 0.0
            END
          + CASE
              WHEN g.geo_label = 'operationally_impractical' THEN 200.0
              ELSE 0.0
            END
        ) AS rec_sort
      FROM (
        SELECT
          elem,
          elem->>'agent_id' AS agent_id,
          wam_ai.geographic_practicality_label(
            v_lead_pin_verified,
            (elem->>'agent_location_verified')::boolean,
            (elem->>'distance_km_raw')::double precision,
            (elem->>'configured_radius_km')::double precision,
            v_closer_count,
            v_min_closer_distance,
            false
          ) AS geo_label
        FROM jsonb_array_elements(v_balanced_ranked) elem
      ) g
    ) s
  ) x;

  -- Recompute geographic_practicality for top recommendation
  IF jsonb_array_length(v_recommendation_ranked) > 0 THEN
    v_recommended := (
      SELECT elem || jsonb_build_object(
        'geographic_practicality', wam_ai.geographic_practicality_label(
          v_lead_pin_verified,
          (elem->>'agent_location_verified')::boolean,
          (elem->>'distance_km_raw')::double precision,
          (elem->>'configured_radius_km')::double precision,
          greatest(0, v_closer_count - 1),
          v_min_closer_distance,
          true
        ),
        'recommendation_rank', 1
      )
      FROM jsonb_array_elements(v_recommendation_ranked) elem
      WHERE (elem->>'recommendation_rank')::int = 1
      LIMIT 1
    );

    v_alternatives := coalesce(
      (
        SELECT jsonb_agg(elem ORDER BY (elem->>'recommendation_rank')::int)
        FROM jsonb_array_elements(v_recommendation_ranked) elem
        WHERE (elem->>'recommendation_rank')::int > 1
          AND (elem->>'recommendation_rank')::int <= v_limit
      ),
      '[]'::jsonb
    );

    v_rec_distance := (v_recommended->>'distance_km_raw')::double precision;

    SELECT count(*)::int INTO v_closer_count
    FROM jsonb_array_elements(v_candidates) c
    WHERE coalesce((c->>'currently_recommendable')::boolean, false)
      AND (c->>'distance_km_raw') IS NOT NULL
      AND v_rec_distance IS NOT NULL
      AND (c->>'distance_km_raw')::double precision < v_rec_distance
      AND (c->>'agent_id') <> (v_recommended->>'agent_id');

    v_radius_expansion := coalesce((v_recommended->>'radius_expansion_required')::boolean, false);

    IF v_radius_expansion THEN
      SELECT coalesce(jsonb_agg(reason), '[]'::jsonb)
      INTO v_closer_reasons
      FROM (
        SELECT jsonb_build_object(
          'agent_business_id', c->>'agent_business_id',
          'distance_km', c->>'distance_km',
          'reasons', c->>'ineligibility_reasons',
          'workload_warning', c->>'workload_warning',
          'availability_status', c->>'availability_status',
          'balanced_business_score', c->>'balanced_business_score'
        ) AS reason
        FROM jsonb_array_elements(v_recommendation_ranked) c
        WHERE (c->>'recommendation_rank')::int > 1
          AND (c->>'distance_km_raw') IS NOT NULL
          AND v_rec_distance IS NOT NULL
          AND (c->>'distance_km_raw')::double precision < v_rec_distance
        LIMIT 5
      ) sub;
    END IF;
  ELSE
    v_recommended := NULL;
    v_alternatives := '[]'::jsonb;
    v_no_rec_reason := CASE
      WHEN NOT v_lead_pin_verified THEN 'missing_lead_coordinates'
      WHEN jsonb_array_length(v_candidates) = 0
        AND jsonb_array_length(v_unavailable_diagnostics) > 0 THEN
        'no_available_agents_check_availability'
      WHEN jsonb_array_length(v_candidates) = 0 THEN 'no_hard_eligible_agents'
      ELSE 'no_practical_candidate'
    END;
    v_mgmt_alternatives := jsonb_build_array(
      CASE
        WHEN jsonb_array_length(v_unavailable_diagnostics) > 0
          THEN 'Check availability of relevant hard-eligible agents before dispatch'
        ELSE NULL
      END,
      'Add or verify agent working pins in Agent Hub',
      'Enable additional agents for dispatch scope and availability',
      'Review admin_queue leads manually',
      'Wait for agent heartbeat / availability in the lead county'
    );
  END IF;

  -- Trim candidate lists to limit; attach ranks from recommendation set
  SELECT coalesce(jsonb_agg(elem ORDER BY (elem->>'recommendation_rank')::int), '[]'::jsonb)
  INTO v_sorted
  FROM jsonb_array_elements(v_recommendation_ranked) elem
  WHERE (elem->>'recommendation_rank')::int <= v_limit;

  IF v_recommended IS NOT NULL
     AND (v_recommended->>'geographic_practicality') = 'operationally_impractical'
     AND v_lead_urgency IN ('normal', 'moderate')
     AND coalesce(v_closer_count, 0) > 0 THEN
    v_recommended := NULL;
    v_alternatives := v_sorted;
    v_no_rec_reason := 'only_operationally_impractical_candidates';
    v_mgmt_alternatives := jsonb_build_array(
      'Wait for a closer agent to become available',
      'Expand agent working coverage in the lead area',
      'Manual admin review for exceptional assignment'
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'recommend_agents_for_lead',
    'recommendation_id', v_recommendation_id,
    'data_freshness_at', v_data_freshness,
    'lead', jsonb_build_object(
      'lead_id', v_lead_id,
      'lead_ref', wam_ai.lead_ref(v_lead_id),
      'status', v_lead.status,
      'product', v_lead.product,
      'county', v_lead.county,
      'installation_town', v_lead.installation_town,
      'lead_state_compatible', true,
      'lead_location_verified', v_lead_pin_verified,
      'lead_waiting_hours', v_lead_waiting_hours,
      'lead_urgency', v_lead_urgency
    ),
    'dispatch_config_snapshot', v_config,
    'configured_radius_km', round(v_default_radius::numeric, 1),
    'radius_expansion_used', coalesce(v_radius_expansion, false),
    'recommended_agent_distance_km', CASE
      WHEN v_recommended IS NULL THEN NULL
      ELSE v_recommended->'distance_km'
    END,
    'closer_eligible_agent_count', coalesce(v_closer_count, 0),
    'closer_agents_not_recommended_reasons', coalesce(v_closer_reasons, '[]'::jsonb),
    'recommended_agent', v_recommended,
    'alternative_agents', coalesce(v_alternatives, '[]'::jsonb),
    'candidates', coalesce(v_sorted, '[]'::jsonb),
    'existing_dispatch_ranking', coalesce(
      (SELECT jsonb_agg(e ORDER BY (e->>'existing_dispatch_rank')::int)
       FROM jsonb_array_elements(v_existing_ranked) e
       WHERE (e->>'existing_dispatch_rank')::int <= v_limit),
      '[]'::jsonb
    ),
    'recommendation_confidence', CASE
      WHEN v_recommended IS NULL THEN 'none'
      WHEN v_lead_pin_verified
        AND (v_recommended->>'agent_location_verified')::boolean
        AND NOT coalesce((v_recommended->>'radius_expansion_required')::boolean, false)
        THEN 'high'
      WHEN v_recommended IS NOT NULL THEN 'moderate'
      ELSE 'low'
    END,
    'recommendation_reasons', CASE
      WHEN v_recommended IS NULL THEN '[]'::jsonb
      ELSE jsonb_build_array(
        'balanced_business_rank_first',
        CASE WHEN (v_recommended->>'online_status') = 'online'
          THEN 'agent_online' ELSE 'agent_offline_acceptable' END,
        CASE WHEN coalesce((v_recommended->>'radius_expansion_required')::boolean, false)
          THEN 'outside_normal_radius_exception' ELSE 'inside_or_acceptable_radius' END,
        CASE WHEN v_urgency_distance_relief > 0
          THEN 'lead_urgency_reduced_geographic_expansion_penalty'
          ELSE 'lead_urgency_normal_geographic_preference' END
      )
    END,
    'recommendation_warnings', CASE
      WHEN v_recommended IS NULL THEN '[]'::jsonb
      WHEN (v_recommended->>'geographic_practicality') = 'operationally_impractical'
        AND v_lead_urgency IN ('elevated', 'high') THEN
        coalesce(v_recommended->'ranking_warnings', '[]'::jsonb)
          || jsonb_build_array('operationally_impractical_but_allowed_for_urgency')
      ELSE coalesce(v_recommended->'ranking_warnings', '[]'::jsonb)
    END,
    'urgency_policy', jsonb_build_object(
      'lead_urgency', v_lead_urgency,
      'distance_relief_factor', v_urgency_distance_relief,
      'semantics',
        'Urgency does not alter hard eligibility or per-agent balanced scores. It reduces geographic expansion penalty at recommendation-rank time and gates operationally_impractical no-recommendation outcomes.',
      'blocks_operationally_impractical_default',
        v_lead_urgency IN ('normal', 'moderate')
    ),
    'no_recommendation_reason', v_no_rec_reason,
    'suggested_management_alternatives', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
      FROM jsonb_array_elements(v_mgmt_alternatives) e(x)
      WHERE x IS NOT NULL AND x <> 'null'::jsonb
    ),
    'unavailable_diagnostics', CASE
      WHEN p_include_unavailable THEN coalesce(v_unavailable_diagnostics, '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    'ineligible_diagnostics', CASE
      WHEN p_include_ineligible_diagnostics THEN coalesce(v_diagnostics, '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    'limit', v_limit,
    'result_count', coalesce(jsonb_array_length(v_sorted), 0),
    'ranking_notes', jsonb_build_object(
      'existing_dispatch_rank',
        'Approximates rankAgentsInRange + online preference + fallback penalty. Does not model preferred_agent_id callback bypass.',
      'balanced_business_rank',
        'Continuous distance penalty beyond configured radius; workload aware. Urgency is applied at recommendation-rank policy, not as a uniform per-agent score shift.',
      'recommendation_rank',
        'Default OpenClaw ordering; may exceed normal radius when evidence supports it. Lead urgency reduces expansion penalty proportionally per candidate distance.',
      'no_fixed_maximum_recommendation_distance', true
    ),
    'metric_definitions', jsonb_build_object(
      'recent_assignments', jsonb_build_object(
        'source_table', 'public.inbound_leads',
        'source_column', 'accepted_at',
        'window', 'performance_window_days',
        'meaning', 'Leads assigned to agent with accepted_at in window',
        'verified', true
      ),
      'recent_accepted_offers', jsonb_build_object(
        'source_table', 'public.lead_offers',
        'source_column', 'responded_at',
        'filter', 'status=accepted',
        'meaning', 'Offers accepted by agent in window',
        'verified', true
      ),
      'recent_registrations', jsonb_build_object(
        'source_table', 'public.customer_registrations',
        'source_column', 'created_at',
        'meaning', 'Registration records created by agent in window',
        'verified', true
      ),
      'recent_registrations_installed_touch', jsonb_build_object(
        'source_table', 'public.customer_registrations',
        'source_column', 'updated_at',
        'filter', 'status=installed',
        'meaning', 'Installed-status registrations touched in window',
        'limitation', 'updated_at is not a verified installation event timestamp',
        'verified', false
      ),
      'recent_conversion_rate', jsonb_build_object(
        'meaning', 'accepted / (accepted+declined+expired) offers in window',
        'verified', true,
        'null_when', 'no denominator offers in window'
      ),
      'pending_or_incomplete_registrations', jsonb_build_object(
        'source_table', 'public.customer_registrations',
        'filter', 'status not in installed,cancelled,rejected',
        'meaning', 'Open registration workload',
        'verified', true
      ),
      'open_active_leads', jsonb_build_object(
        'source_table', 'public.inbound_leads',
        'meaning', 'Dispatch-active assigned leads for agent',
        'verified', true
      ),
      'active_offer_count', jsonb_build_object(
        'source_table', 'public.lead_offers',
        'filter', 'status=pending',
        'meaning', 'Pending offers awaiting agent response',
        'verified', true
      ),
      'last_activity_at', jsonb_build_object(
        'source_table', 'public.agent_dispatch_status',
        'source_column', 'last_seen_at',
        'meaning', 'Last agent heartbeat for dispatch presence',
        'verified', true
      )
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.recommend_agents_for_lead(
  uuid, text, integer, boolean, boolean, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.recommend_agents_for_lead(
  uuid, text, integer, boolean, boolean, integer
) FROM anon;
REVOKE ALL ON FUNCTION wam_ai.recommend_agents_for_lead(
  uuid, text, integer, boolean, boolean, integer
) FROM authenticated;

-- Phase 1A.2 internal helpers: not independently callable by API roles
DO $priv$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN (
        'haversine_km',
        'parse_working_place_coords',
        'parse_lead_google_place_coords',
        'agent_accepts_product',
        'effective_service_radius_km',
        'is_agent_online',
        'clamp_recommend_limit',
        'clamp_performance_window_days',
        'load_dispatch_snapshot',
        'geographic_practicality_label',
        'lead_recommendation_compatible'
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
$priv$;

COMMENT ON FUNCTION wam_ai.recommend_agents_for_lead IS
  'MCP: wam.business.dispatch.recommend_agents_for_lead — read-only agent recommendations for an unassigned lead.';

-- Production grant (apply manually after review):
-- GRANT EXECUTE ON FUNCTION wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer)
--   TO wam_ai_business_readonly;
