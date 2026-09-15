-- =============================================================================
-- WAM APPS AI Phase 1A.1 — authorized open-book business reporting (Agent Hub)
-- Additive only: does NOT alter operational tables, RLS, triggers, or Phase 1A
-- analytics functions. Grants commented for wam_ai_business_readonly.
-- =============================================================================

-- Extend audit classifications for personal_data / highly_sensitive outputs.
ALTER TABLE wam_ai.audit_events DROP CONSTRAINT IF EXISTS audit_events_data_classification_check;
ALTER TABLE wam_ai.audit_events ADD CONSTRAINT audit_events_data_classification_check
  CHECK (data_classification IN (
    'safe_aggregate',
    'internal_operational',
    'personal_minimized',
    'personal_data',
    'highly_sensitive',
    'denied'
  ));

CREATE OR REPLACE FUNCTION wam_ai.clamp_search_limit(p_limit integer)
RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE c wam_ai.reporting_config;
BEGIN
  c := wam_ai.cfg();
  -- Open-book search default 25; hard max from config (100).
  RETURN LEAST(GREATEST(COALESCE(p_limit, 25), 1), c.max_list_limit);
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.assert_meaningful_search_filter(p_filters text[])
RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM unnest(p_filters) f WHERE f IS NOT NULL AND btrim(f) <> ''
  ) THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.normalize_phone_search(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT NULLIF(regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'), '');
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.evidence_ref(p_kind text, p_entity_id uuid, p_field text)
RETURNS text
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT 'EV-' || left(encode(extensions.digest(
    coalesce(p_kind, '') || ':' || p_entity_id::text || ':' || coalesce(p_field, '') || ':' ||
    (SELECT opaque_ref_pepper FROM wam_ai.reporting_config WHERE id = 1), 'sha256'), 'hex'), 16);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.normalize_agent_business_ref(p_ref text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_raw text := NULLIF(btrim(p_ref), '');
  v_suffix text;
BEGIN
  IF v_raw IS NULL THEN RETURN NULL; END IF;
  IF v_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  IF v_raw ~* '^[0-9a-f]{32}$' THEN RETURN NULL; END IF;
  v_suffix := upper(regexp_replace(v_raw, '^A-', '', 'i'));
  IF v_suffix !~ '^[0-9A-F]{8}$' THEN RETURN NULL; END IF;
  RETURN 'A-' || v_suffix;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.resolve_agent_business_id(p_business_id text)
RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_ref text := wam_ai.normalize_agent_business_ref(p_business_id);
  v_count integer;
  v_id uuid;
BEGIN
  IF v_ref IS NULL THEN RETURN NULL; END IF;
  SELECT count(*)::int INTO v_count FROM public.agents a
  WHERE wam_ai.agent_business_id(a.id) = v_ref;
  IF v_count <> 1 THEN RETURN NULL; END IF;
  SELECT a.id INTO v_id FROM public.agents a
  WHERE wam_ai.agent_business_id(a.id) = v_ref
  ORDER BY a.id LIMIT 1;
  RETURN v_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- search_agents — list view; no secrets; max 25 default / 100 hard max
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.search_agents(
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_county text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_limit integer := wam_ai.clamp_search_limit(p_limit);
  v_name text := NULLIF(btrim(p_name), '');
  v_phone text := wam_ai.normalize_phone_search(p_phone);
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_county text := NULLIF(btrim(p_county), '');
  v_status text := NULLIF(lower(btrim(p_status)), '');
  v jsonb;
BEGIN
  PERFORM wam_ai.assert_meaningful_search_filter(ARRAY[
    v_name, v_phone, v_email, v_county, v_status
  ]);
  SELECT jsonb_build_object(
    'operation', 'search_agents',
    'limit', v_limit,
    'result_count', (
      SELECT count(*)::int FROM public.agents a
      LEFT JOIN public.agent_dispatch_settings ads ON ads.agent_id = a.id
      WHERE (v_name IS NULL OR a.name ILIKE '%' || v_name || '%')
        AND (v_email IS NULL OR lower(coalesce(a.email, '')) LIKE '%' || v_email || '%')
        AND (v_status IS NULL OR lower(coalesce(a.status, '')) = v_status)
        AND (v_county IS NULL OR coalesce(ads.county, a.town, a.area, '') ILIKE '%' || v_county || '%')
        AND (v_phone IS NULL OR wam_ai.normalize_phone_search(a.airtel_phone) = v_phone
          OR wam_ai.normalize_phone_search(a.safaricom_phone) = v_phone)
    ),
    'agents', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name)
      FROM (
        SELECT
          a.id AS agent_id,
          wam_ai.agent_business_id(a.id) AS agent_business_id,
          a.name,
          a.email,
          a.airtel_phone,
          a.safaricom_phone,
          a.town,
          a.area,
          coalesce(ads.county, a.town) AS county,
          a.status,
          a.lead_dispatch_scope,
          coalesce(ads.is_available, false) AS is_available,
          (SELECT count(*)::int FROM public.inbound_leads l
            WHERE l.assigned_agent_id = a.id
              AND l.status NOT IN ('installed', 'lost', 'expired')) AS open_leads_count,
          coalesce(a.total_earnings, 0) AS total_earnings_ksh,
          coalesce(a.available_balance, 0) AS available_balance_ksh
        FROM public.agents a
        LEFT JOIN public.agent_dispatch_settings ads ON ads.agent_id = a.id
        WHERE (v_name IS NULL OR a.name ILIKE '%' || v_name || '%')
          AND (v_email IS NULL OR lower(coalesce(a.email, '')) LIKE '%' || v_email || '%')
          AND (v_status IS NULL OR lower(coalesce(a.status, '')) = v_status)
          AND (v_county IS NULL OR coalesce(ads.county, a.town, a.area, '') ILIKE '%' || v_county || '%')
          AND (v_phone IS NULL OR wam_ai.normalize_phone_search(a.airtel_phone) = v_phone
            OR wam_ai.normalize_phone_search(a.safaricom_phone) = v_phone)
        ORDER BY a.name
        LIMIT v_limit
      ) t
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- get_agent_details — single record or ambiguity/not_found
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.get_agent_details(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_id uuid := p_agent_id;
  v_bid text := NULLIF(btrim(p_agent_business_id), '');
  v_norm text;
  v_match_count integer := 0;
  v jsonb;
BEGIN
  IF v_id IS NULL AND v_bid IS NULL THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
  v_norm := wam_ai.normalize_agent_business_ref(v_bid);
  IF v_bid IS NOT NULL AND v_norm IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'not_found', 'match_count', 0, 'agent', NULL,
      'message', 'Invalid agent_business_id; raw UUID strings are not accepted as safe references');
  END IF;
  IF v_id IS NOT NULL AND v_norm IS NOT NULL THEN
    IF wam_ai.agent_business_id(v_id) <> v_norm THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'agent_id and agent_business_id refer to different agents'
      );
    END IF;
  END IF;
  IF v_id IS NULL AND v_norm IS NOT NULL THEN
    SELECT count(*)::int INTO v_match_count
    FROM public.agents a
    WHERE wam_ai.agent_business_id(a.id) = v_norm;
    IF v_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'agent', NULL);
    ELSIF v_match_count > 1 THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', v_match_count,
        'message', 'Multiple agents match agent_business_id; provide agent_id'
      );
    END IF;
    SELECT a.id INTO v_id FROM public.agents a
    WHERE wam_ai.agent_business_id(a.id) = v_norm
    ORDER BY a.id LIMIT 1;
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT count(*)::int INTO v_match_count FROM public.agents WHERE id = v_id;
    IF v_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'agent', NULL);
    END IF;
  END IF;
  SELECT jsonb_build_object(
    'status', 'success',
    'match_count', 1,
    'agent', (
      SELECT jsonb_build_object(
        'agent_id', a.id,
        'agent_business_id', wam_ai.agent_business_id(a.id),
        'name', a.name,
        'email', a.email,
        'airtel_phone', a.airtel_phone,
        'safaricom_phone', a.safaricom_phone,
        'town', a.town,
        'area', a.area,
        'county', coalesce(ads.county, a.town),
        'working_place', a.working_place,
        'status', a.status,
        'lead_dispatch_scope', a.lead_dispatch_scope,
        'is_available', coalesce(ads.is_available, false),
        'total_earnings_ksh', coalesce(a.total_earnings, 0),
        'available_balance_ksh', coalesce(a.available_balance, 0),
        'workload', jsonb_build_object(
          'open_leads_count', (SELECT count(*)::int FROM public.inbound_leads l
            WHERE l.assigned_agent_id = a.id
              AND l.status NOT IN ('installed', 'lost', 'expired')),
          'active_offers_count', (SELECT count(*)::int FROM public.lead_offers o
            WHERE o.agent_id = a.id AND o.status = 'offered')
        ),
        'offer_history', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'status', o.status,
            'count', cnt
          ) ORDER BY cnt DESC)
          FROM (
            SELECT o.status, count(*)::int cnt
            FROM public.lead_offers o WHERE o.agent_id = a.id GROUP BY o.status
          ) o
        ), '[]'::jsonb),
        'performance', jsonb_build_object(
          'registrations_count', (SELECT count(*)::int FROM public.customer_registrations cr
            WHERE cr.agent_id = a.id),
          'registrations_installed', (SELECT count(*)::int FROM public.customer_registrations cr
            WHERE cr.agent_id = a.id AND cr.status = 'installed'),
          'inbound_installs', (SELECT count(*)::int FROM public.inbound_leads l
            WHERE l.assigned_agent_id = a.id AND l.status = 'installed'),
          'offers_accepted', (SELECT count(*)::int FROM public.lead_offers o
            WHERE o.agent_id = a.id AND o.status = 'accepted')
        ),
        'recent_payments', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'payment_id', p.id,
            'amount_ksh', p.amount_ksh,
            'created_at', p.created_at
          ) ORDER BY p.created_at DESC)
          FROM (
            SELECT id, amount_ksh, created_at
            FROM public.agent_payments
            WHERE agent_id = a.id
            ORDER BY created_at DESC
            LIMIT 10
          ) p
        ), '[]'::jsonb)
      )
      FROM public.agents a
      LEFT JOIN public.agent_dispatch_settings ads ON ads.agent_id = a.id
      WHERE a.id = v_id
    )
  ) INTO v;
  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- search_leads — no national_id in list results
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.search_leads(
  p_lead_ref text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_county text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_product text DEFAULT NULL,
  p_assigned_agent_id uuid DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_limit integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_limit integer := wam_ai.clamp_search_limit(p_limit);
  v_ref text := NULLIF(btrim(p_lead_ref), '');
  v_phone text := wam_ai.normalize_phone_search(p_phone);
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_name text := NULLIF(btrim(p_name), '');
  v_county text := NULLIF(btrim(p_county), '');
  v_status text := NULLIF(lower(btrim(p_status)), '');
  v_product text := NULLIF(lower(btrim(p_product)), '');
  v_source text := NULLIF(lower(btrim(p_source)), '');
  v jsonb;
BEGIN
  PERFORM wam_ai.assert_meaningful_search_filter(ARRAY[
    v_ref, v_phone, v_email, v_name, v_county, v_status, v_product,
    CASE WHEN p_assigned_agent_id IS NULL THEN NULL ELSE p_assigned_agent_id::text END,
    v_source
  ]);
  IF v_product IS NOT NULL AND v_product NOT IN ('airtel', 'safaricom') THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
  IF v_source IS NOT NULL AND v_source NOT IN ('airtel5grouter', 'internetkenya', 'agent_own') THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object(
    'operation', 'search_leads',
    'limit', v_limit,
    'result_count', (
      SELECT count(*)::int FROM public.inbound_leads l
      WHERE (v_ref IS NULL OR wam_ai.lead_ref(l.id) = v_ref)
        AND (v_name IS NULL OR l.customer_name ILIKE '%' || v_name || '%')
        AND (v_email IS NULL OR lower(coalesce(l.email, '')) LIKE '%' || v_email || '%')
        AND (v_county IS NULL OR coalesce(l.county, '') ILIKE '%' || v_county || '%')
        AND (v_status IS NULL OR lower(l.status) = v_status)
        AND (v_product IS NULL OR l.product = v_product)
        AND (v_source IS NULL OR l.source = v_source)
        AND (p_assigned_agent_id IS NULL OR l.assigned_agent_id = p_assigned_agent_id)
        AND (v_phone IS NULL OR wam_ai.normalize_phone_search(l.primary_phone) = v_phone
          OR wam_ai.normalize_phone_search(l.alternate_phone) = v_phone)
    ),
    'leads', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC)
      FROM (
        SELECT
          l.id AS lead_id,
          wam_ai.lead_ref(l.id) AS lead_ref,
          l.customer_name,
          l.primary_phone,
          l.alternate_phone,
          l.email,
          l.county,
          l.installation_town,
          l.installation_area,
          l.source,
          l.product,
          l.status,
          l.assigned_agent_id,
          wam_ai.agent_business_id(l.assigned_agent_id) AS assigned_agent_business_id,
          (SELECT ag.name FROM public.agents ag WHERE ag.id = l.assigned_agent_id) AS assigned_agent_name,
          l.created_at,
          l.updated_at,
          l.commission_earned_ksh
        FROM public.inbound_leads l
        WHERE (v_ref IS NULL OR wam_ai.lead_ref(l.id) = v_ref)
          AND (v_name IS NULL OR l.customer_name ILIKE '%' || v_name || '%')
          AND (v_email IS NULL OR lower(coalesce(l.email, '')) LIKE '%' || v_email || '%')
          AND (v_county IS NULL OR coalesce(l.county, '') ILIKE '%' || v_county || '%')
          AND (v_status IS NULL OR lower(l.status) = v_status)
          AND (v_product IS NULL OR l.product = v_product)
          AND (v_source IS NULL OR l.source = v_source)
          AND (p_assigned_agent_id IS NULL OR l.assigned_agent_id = p_assigned_agent_id)
          AND (v_phone IS NULL OR wam_ai.normalize_phone_search(l.primary_phone) = v_phone
            OR wam_ai.normalize_phone_search(l.alternate_phone) = v_phone)
        ORDER BY l.created_at DESC
        LIMIT v_limit
      ) t
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- get_lead_details — single record; national_id only on exact success
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.get_lead_details(
  p_lead_id uuid DEFAULT NULL,
  p_lead_ref text DEFAULT NULL,
  p_primary_phone text DEFAULT NULL,
  p_national_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_id uuid := p_lead_id;
  v_ref text := NULLIF(btrim(p_lead_ref), '');
  v_phone text := wam_ai.normalize_phone_search(p_primary_phone);
  v_nid text := NULLIF(btrim(p_national_id), '');
  v_match_count integer := 0;
  v jsonb;
BEGIN
  IF v_id IS NULL AND v_ref IS NULL AND v_phone IS NULL AND v_nid IS NULL THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NOT NULL AND v_ref IS NOT NULL AND wam_ai.lead_ref(v_id) <> v_ref THEN
    RETURN jsonb_build_object(
      'status', 'ambiguous',
      'match_count', 2,
      'message', 'lead_id and lead_ref refer to different leads'
    );
  END IF;
  IF v_id IS NULL AND v_ref IS NOT NULL THEN
    SELECT l.id INTO v_id FROM public.inbound_leads l WHERE wam_ai.lead_ref(l.id) = v_ref LIMIT 1;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'lead', NULL);
    END IF;
  END IF;
  IF v_id IS NULL AND v_phone IS NOT NULL THEN
    SELECT count(*)::int, min(l.id) INTO v_match_count, v_id
    FROM public.inbound_leads l
    WHERE wam_ai.normalize_phone_search(l.primary_phone) = v_phone
       OR wam_ai.normalize_phone_search(l.alternate_phone) = v_phone;
    IF v_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'lead', NULL);
    ELSIF v_match_count > 1 THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', v_match_count,
        'message', 'Multiple leads match phone; provide lead_id or lead_ref'
      );
    END IF;
  END IF;
  IF v_id IS NULL AND v_nid IS NOT NULL THEN
    SELECT count(*)::int, min(l.id) INTO v_match_count, v_id
    FROM public.inbound_leads l WHERE l.national_id = v_nid;
    IF v_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'lead', NULL);
    ELSIF v_match_count > 1 THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', v_match_count,
        'message', 'Multiple leads match national_id; provide lead_id or lead_ref'
      );
    END IF;
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT count(*)::int INTO v_match_count FROM public.inbound_leads WHERE id = v_id;
    IF v_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'lead', NULL);
    END IF;
  END IF;
  -- Cross-validate: every supplied identifier must refer to the same resolved lead.
  IF v_id IS NOT NULL THEN
    IF v_ref IS NOT NULL AND wam_ai.lead_ref(v_id) <> v_ref THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'lead_ref does not match other supplied identifiers'
      );
    END IF;
    IF v_phone IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.inbound_leads l WHERE l.id = v_id
        AND (wam_ai.normalize_phone_search(l.primary_phone) = v_phone
          OR wam_ai.normalize_phone_search(l.alternate_phone) = v_phone)
    ) THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'primary_phone does not match other supplied identifiers'
      );
    END IF;
    IF v_nid IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.inbound_leads l WHERE l.id = v_id AND l.national_id = v_nid
    ) THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'national_id does not match other supplied identifiers'
      );
    END IF;
  END IF;
  SELECT jsonb_build_object(
    'status', 'success',
    'match_count', 1,
    'lead', (
      SELECT jsonb_build_object(
        'lead_id', l.id,
        'lead_ref', wam_ai.lead_ref(l.id),
        'customer_name', l.customer_name,
        'primary_phone', l.primary_phone,
        'alternate_phone', l.alternate_phone,
        'email', l.email,
        'national_id', l.national_id,
        'county', l.county,
        'installation_town', l.installation_town,
        'installation_area', l.installation_area,
        'delivery_landmark', l.delivery_landmark,
        'source', l.source,
        'product', l.product,
        'status', l.status,
        'kyc_outcome', l.kyc_outcome,
        'assigned_agent_id', l.assigned_agent_id,
        'assigned_agent_business_id', wam_ai.agent_business_id(l.assigned_agent_id),
        'assigned_agent_name', (SELECT ag.name FROM public.agents ag WHERE ag.id = l.assigned_agent_id),
        'commission_earned_ksh', l.commission_earned_ksh,
        'registration_id', l.registration_id,
        'airtel_sr_number', l.airtel_sr_number,
        'safaricom_imei', l.safaricom_imei,
        'timestamps', jsonb_build_object(
          'created_at', l.created_at,
          'updated_at', l.updated_at,
          'accepted_at', l.accepted_at,
          'kyc_started_at', l.kyc_started_at,
          'kyc_completed_at', l.kyc_completed_at,
          'installed_at', l.installed_at,
          'callback_at', l.callback_at
        ),
        'installation_evidence', COALESCE((
          SELECT jsonb_agg(ev ORDER BY ev->>'type')
          FROM (
            SELECT jsonb_build_object(
              'evidence_ref', wam_ai.evidence_ref('lead', l.id, 'airtel_sr_number'),
              'type', 'airtel_sr_number',
              'value', l.airtel_sr_number,
              'recorded_at', l.installed_at
            ) AS ev
            WHERE l.airtel_sr_number IS NOT NULL
            UNION ALL
            SELECT jsonb_build_object(
              'evidence_ref', wam_ai.evidence_ref('lead', l.id, 'safaricom_imei'),
              'type', 'safaricom_imei',
              'value', l.safaricom_imei,
              'recorded_at', l.installed_at
            )
            WHERE l.safaricom_imei IS NOT NULL
          ) ev_rows
        ), '[]'::jsonb),
        'activity_history', COALESCE((
          SELECT jsonb_agg(ev ORDER BY ev->>'at')
          FROM (
            SELECT jsonb_build_object('event', 'created', 'at', l.created_at) AS ev
            UNION ALL SELECT jsonb_build_object('event', 'accepted', 'at', l.accepted_at) WHERE l.accepted_at IS NOT NULL
            UNION ALL SELECT jsonb_build_object('event', 'kyc_started', 'at', l.kyc_started_at) WHERE l.kyc_started_at IS NOT NULL
            UNION ALL SELECT jsonb_build_object('event', 'kyc_completed', 'at', l.kyc_completed_at) WHERE l.kyc_completed_at IS NOT NULL
            UNION ALL SELECT jsonb_build_object('event', 'installed', 'at', l.installed_at) WHERE l.installed_at IS NOT NULL
          ) ev_rows
        ), '[]'::jsonb),
        'offer_history', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'offer_id', o.id,
            'agent_business_id', wam_ai.agent_business_id(o.agent_id),
            'status', o.status,
            'created_at', o.created_at,
            'responded_at', o.responded_at,
            'expires_at', o.expires_at
          ) ORDER BY o.created_at DESC)
          FROM public.lead_offers o WHERE o.lead_id = l.id
        ), '[]'::jsonb)
      )
      FROM public.inbound_leads l WHERE l.id = v_id
    )
  ) INTO v;
  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- search_customers — inbound leads + registrations; no national_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.search_customers(
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_county text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_product text DEFAULT NULL,
  p_assigned_agent_id uuid DEFAULT NULL,
  p_limit integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_limit integer := wam_ai.clamp_search_limit(p_limit);
  v_name text := NULLIF(btrim(p_name), '');
  v_phone text := wam_ai.normalize_phone_search(p_phone);
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_county text := NULLIF(btrim(p_county), '');
  v_status text := NULLIF(lower(btrim(p_status)), '');
  v_product text := NULLIF(lower(btrim(p_product)), '');
  v jsonb;
BEGIN
  PERFORM wam_ai.assert_meaningful_search_filter(ARRAY[
    v_name, v_phone, v_email, v_county, v_status, v_product,
    CASE WHEN p_assigned_agent_id IS NULL THEN NULL ELSE p_assigned_agent_id::text END
  ]);
  IF v_product IS NOT NULL AND v_product NOT IN ('airtel', 'safaricom') THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object(
    'operation', 'search_customers',
    'limit', v_limit,
    'result_count', (
      SELECT count(*)::int FROM (
        SELECT l.id FROM public.inbound_leads l
        WHERE (v_name IS NULL OR l.customer_name ILIKE '%' || v_name || '%')
          AND (v_email IS NULL OR lower(coalesce(l.email, '')) LIKE '%' || v_email || '%')
          AND (v_county IS NULL OR coalesce(l.county, '') ILIKE '%' || v_county || '%')
          AND (v_status IS NULL OR lower(l.status) = v_status)
          AND (v_product IS NULL OR l.product = v_product)
          AND (p_assigned_agent_id IS NULL OR l.assigned_agent_id = p_assigned_agent_id)
          AND (v_phone IS NULL OR wam_ai.normalize_phone_search(l.primary_phone) = v_phone
            OR wam_ai.normalize_phone_search(l.alternate_phone) = v_phone)
        UNION ALL
        SELECT cr.id FROM public.customer_registrations cr
        WHERE (v_name IS NULL OR cr.customer_name ILIKE '%' || v_name || '%')
          AND (v_email IS NULL OR lower(coalesce(cr.email, '')) LIKE '%' || v_email || '%')
          AND (v_county IS NULL OR coalesce(cr.installation_town, '') ILIKE '%' || v_county || '%')
          AND (v_status IS NULL OR lower(cr.status) = v_status)
          AND (p_assigned_agent_id IS NULL OR cr.agent_id = p_assigned_agent_id)
          AND (v_phone IS NULL OR wam_ai.normalize_phone_search(cr.airtel_number) = v_phone
            OR wam_ai.normalize_phone_search(cr.alternate_number) = v_phone)
          AND (v_product IS NULL OR v_product = 'airtel')
      ) u
    ),
    'customers', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC)
      FROM (
        SELECT * FROM (
          SELECT
            'inbound_lead'::text AS record_type,
            l.id AS record_id,
            wam_ai.lead_ref(l.id) AS business_ref,
            l.customer_name,
            l.primary_phone AS phone,
            l.email,
            l.county,
            l.installation_town AS town,
            l.product,
            l.status,
            l.assigned_agent_id,
            wam_ai.agent_business_id(l.assigned_agent_id) AS assigned_agent_business_id,
            (SELECT ag.name FROM public.agents ag WHERE ag.id = l.assigned_agent_id) AS assigned_agent_name,
            l.created_at,
            l.updated_at,
            l.commission_earned_ksh
          FROM public.inbound_leads l
          WHERE (v_name IS NULL OR l.customer_name ILIKE '%' || v_name || '%')
            AND (v_email IS NULL OR lower(coalesce(l.email, '')) LIKE '%' || v_email || '%')
            AND (v_county IS NULL OR coalesce(l.county, '') ILIKE '%' || v_county || '%')
            AND (v_status IS NULL OR lower(l.status) = v_status)
            AND (v_product IS NULL OR l.product = v_product)
            AND (p_assigned_agent_id IS NULL OR l.assigned_agent_id = p_assigned_agent_id)
            AND (v_phone IS NULL OR wam_ai.normalize_phone_search(l.primary_phone) = v_phone
              OR wam_ai.normalize_phone_search(l.alternate_phone) = v_phone)
          UNION ALL
          SELECT
            'customer_registration'::text,
            cr.id,
            'CR-' || left(replace(cr.id::text, '-', ''), 8),
            cr.customer_name,
            cr.airtel_number,
            cr.email,
            cr.installation_town,
            cr.installation_town,
            'airtel'::text,
            cr.status,
            cr.agent_id,
            wam_ai.agent_business_id(cr.agent_id),
            (SELECT ag.name FROM public.agents ag WHERE ag.id = cr.agent_id),
            cr.created_at,
            cr.updated_at,
            NULL::numeric
          FROM public.customer_registrations cr
          WHERE (v_name IS NULL OR cr.customer_name ILIKE '%' || v_name || '%')
            AND (v_email IS NULL OR lower(coalesce(cr.email, '')) LIKE '%' || v_email || '%')
            AND (v_county IS NULL OR coalesce(cr.installation_town, '') ILIKE '%' || v_county || '%')
            AND (v_status IS NULL OR lower(cr.status) = v_status)
            AND (p_assigned_agent_id IS NULL OR cr.agent_id = p_assigned_agent_id)
            AND (v_phone IS NULL OR wam_ai.normalize_phone_search(cr.airtel_number) = v_phone
              OR wam_ai.normalize_phone_search(cr.alternate_number) = v_phone)
            AND (v_product IS NULL OR v_product = 'airtel')
        ) combined
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT v_limit
      ) t
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- get_customer_details — single record; national_id on inbound_lead only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.get_customer_details(
  p_record_type text DEFAULT NULL,
  p_record_id uuid DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_national_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_type text := NULLIF(lower(btrim(p_record_type)), '');
  v_id uuid := p_record_id;
  v_phone text := wam_ai.normalize_phone_search(p_phone);
  v_email text := NULLIF(lower(btrim(p_email)), '');
  v_nid text := NULLIF(btrim(p_national_id), '');
  v_match_count integer := 0;
  v jsonb;
BEGIN
  IF v_type IS NOT NULL AND v_type NOT IN ('inbound_lead', 'customer_registration') THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NOT NULL AND v_type IS NULL THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NULL AND v_phone IS NULL AND v_email IS NULL AND v_nid IS NULL THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NOT NULL THEN
    IF v_type = 'inbound_lead' THEN
      SELECT count(*)::int INTO v_match_count FROM public.inbound_leads WHERE id = v_id;
    ELSE
      SELECT count(*)::int INTO v_match_count FROM public.customer_registrations WHERE id = v_id;
    END IF;
    IF v_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'customer', NULL);
    END IF;
  ELSIF v_phone IS NOT NULL THEN
    SELECT count(*)::int INTO v_match_count FROM (
      SELECT l.id FROM public.inbound_leads l
      WHERE wam_ai.normalize_phone_search(l.primary_phone) = v_phone
         OR wam_ai.normalize_phone_search(l.alternate_phone) = v_phone
      UNION ALL
      SELECT cr.id FROM public.customer_registrations cr
      WHERE wam_ai.normalize_phone_search(cr.airtel_number) = v_phone
         OR wam_ai.normalize_phone_search(cr.alternate_number) = v_phone
    ) u;
    IF v_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'customer', NULL);
    ELSIF v_match_count > 1 THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', v_match_count,
        'message', 'Multiple customers match phone; provide record_type and record_id'
      );
    END IF;
    -- Resolve single match
    SELECT 'inbound_lead', l.id INTO v_type, v_id
    FROM public.inbound_leads l
    WHERE wam_ai.normalize_phone_search(l.primary_phone) = v_phone
       OR wam_ai.normalize_phone_search(l.alternate_phone) = v_phone
    LIMIT 1;
    IF v_id IS NULL THEN
      SELECT 'customer_registration', cr.id INTO v_type, v_id
      FROM public.customer_registrations cr
      WHERE wam_ai.normalize_phone_search(cr.airtel_number) = v_phone
         OR wam_ai.normalize_phone_search(cr.alternate_number) = v_phone
      LIMIT 1;
    END IF;
  ELSIF v_email IS NOT NULL THEN
    SELECT count(*)::int INTO v_match_count FROM (
      SELECT l.id FROM public.inbound_leads l WHERE lower(coalesce(l.email, '')) = v_email
      UNION ALL
      SELECT cr.id FROM public.customer_registrations cr WHERE lower(coalesce(cr.email, '')) = v_email
    ) u;
    IF v_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'customer', NULL);
    ELSIF v_match_count > 1 THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', v_match_count,
        'message', 'Multiple customers match email; provide record_type and record_id'
      );
    END IF;
    SELECT 'inbound_lead', l.id INTO v_type, v_id
    FROM public.inbound_leads l WHERE lower(coalesce(l.email, '')) = v_email LIMIT 1;
    IF v_id IS NULL THEN
      SELECT 'customer_registration', cr.id INTO v_type, v_id
      FROM public.customer_registrations cr WHERE lower(coalesce(cr.email, '')) = v_email LIMIT 1;
    END IF;
  ELSIF v_nid IS NOT NULL THEN
    SELECT count(*)::int, min(l.id) INTO v_match_count, v_id
    FROM public.inbound_leads l WHERE l.national_id = v_nid;
    IF v_match_count = 0 THEN
      RETURN jsonb_build_object('status', 'not_found', 'match_count', 0, 'customer', NULL);
    ELSIF v_match_count > 1 THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', v_match_count,
        'message', 'Multiple customers match national_id; provide record_type and record_id'
      );
    END IF;
    v_type := 'inbound_lead';
  END IF;
  -- Cross-validate: every supplied identifier must refer to the same resolved customer.
  IF v_id IS NOT NULL AND v_type = 'inbound_lead' THEN
    IF v_phone IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.inbound_leads l WHERE l.id = v_id
        AND (wam_ai.normalize_phone_search(l.primary_phone) = v_phone
          OR wam_ai.normalize_phone_search(l.alternate_phone) = v_phone)
    ) THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'phone does not match other supplied identifiers'
      );
    END IF;
    IF v_email IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.inbound_leads l
      WHERE l.id = v_id AND lower(coalesce(l.email, '')) = v_email
    ) THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'email does not match other supplied identifiers'
      );
    END IF;
    IF v_nid IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.inbound_leads l WHERE l.id = v_id AND l.national_id = v_nid
    ) THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'national_id does not match other supplied identifiers'
      );
    END IF;
  ELSIF v_id IS NOT NULL AND v_type = 'customer_registration' THEN
    IF v_nid IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'national_id applies to inbound_lead records only'
      );
    END IF;
    IF v_phone IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.customer_registrations cr WHERE cr.id = v_id
        AND (wam_ai.normalize_phone_search(cr.airtel_number) = v_phone
          OR wam_ai.normalize_phone_search(cr.alternate_number) = v_phone)
    ) THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'phone does not match other supplied identifiers'
      );
    END IF;
    IF v_email IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.customer_registrations cr
      WHERE cr.id = v_id AND lower(coalesce(cr.email, '')) = v_email
    ) THEN
      RETURN jsonb_build_object(
        'status', 'ambiguous',
        'match_count', 2,
        'message', 'email does not match other supplied identifiers'
      );
    END IF;
  END IF;
  IF v_type = 'inbound_lead' THEN
    SELECT jsonb_build_object(
      'status', 'success',
      'match_count', 1,
      'customer', (
        SELECT jsonb_build_object(
          'record_type', 'inbound_lead',
          'record_id', l.id,
          'business_ref', wam_ai.lead_ref(l.id),
          'customer_name', l.customer_name,
          'primary_phone', l.primary_phone,
          'alternate_phone', l.alternate_phone,
          'email', l.email,
          'national_id', l.national_id,
          'county', l.county,
          'installation_town', l.installation_town,
          'installation_area', l.installation_area,
          'delivery_landmark', l.delivery_landmark,
          'source', l.source,
          'product', l.product,
          'status', l.status,
          'kyc_outcome', l.kyc_outcome,
          'assigned_agent_id', l.assigned_agent_id,
          'assigned_agent_business_id', wam_ai.agent_business_id(l.assigned_agent_id),
          'assigned_agent_name', (SELECT ag.name FROM public.agents ag WHERE ag.id = l.assigned_agent_id),
          'commission_earned_ksh', l.commission_earned_ksh,
          'registration_id', l.registration_id,
          'inbound_lead_id', l.id,
          'airtel_sr_number', l.airtel_sr_number,
          'safaricom_imei', l.safaricom_imei,
          'timestamps', jsonb_build_object(
            'created_at', l.created_at,
            'updated_at', l.updated_at,
            'accepted_at', l.accepted_at,
            'kyc_started_at', l.kyc_started_at,
            'kyc_completed_at', l.kyc_completed_at,
            'installed_at', l.installed_at
          ),
          'installation_evidence', COALESCE((
            SELECT jsonb_agg(ev ORDER BY ev->>'type')
            FROM (
              SELECT jsonb_build_object(
                'evidence_ref', wam_ai.evidence_ref('lead', l.id, 'airtel_sr_number'),
                'type', 'airtel_sr_number',
                'value', l.airtel_sr_number,
                'recorded_at', l.installed_at
              ) AS ev
              WHERE l.airtel_sr_number IS NOT NULL
              UNION ALL
              SELECT jsonb_build_object(
                'evidence_ref', wam_ai.evidence_ref('lead', l.id, 'safaricom_imei'),
                'type', 'safaricom_imei',
                'value', l.safaricom_imei,
                'recorded_at', l.installed_at
              )
              WHERE l.safaricom_imei IS NOT NULL
            ) ev_rows
          ), '[]'::jsonb),
          'activity_history', COALESCE((
            SELECT jsonb_agg(ev ORDER BY ev->>'at')
            FROM (
              SELECT jsonb_build_object('event', 'created', 'at', l.created_at) AS ev
              UNION ALL SELECT jsonb_build_object('event', 'kyc_completed', 'at', l.kyc_completed_at) WHERE l.kyc_completed_at IS NOT NULL
              UNION ALL SELECT jsonb_build_object('event', 'installed', 'at', l.installed_at) WHERE l.installed_at IS NOT NULL
            ) ev_rows
          ), '[]'::jsonb)
        )
        FROM public.inbound_leads l WHERE l.id = v_id
      )
    ) INTO v;
  ELSE
    SELECT jsonb_build_object(
      'status', 'success',
      'match_count', 1,
      'customer', (
        SELECT jsonb_build_object(
          'record_type', 'customer_registration',
          'record_id', cr.id,
          'business_ref', 'CR-' || left(replace(cr.id::text, '-', ''), 8),
          'customer_name', cr.customer_name,
          'primary_phone', cr.airtel_number,
          'alternate_phone', cr.alternate_number,
          'email', cr.email,
          'installation_town', cr.installation_town,
          'delivery_landmark', cr.delivery_landmark,
          'installation_location', cr.installation_location,
          'preferred_package', cr.preferred_package,
          'status', cr.status,
          'assigned_agent_id', cr.agent_id,
          'assigned_agent_business_id', wam_ai.agent_business_id(cr.agent_id),
          'assigned_agent_name', (SELECT ag.name FROM public.agents ag WHERE ag.id = cr.agent_id),
          'inbound_lead_id', cr.inbound_lead_id,
          'timestamps', jsonb_build_object(
            'created_at', cr.created_at,
            'updated_at', cr.updated_at,
            'ms_forms_submitted_at', cr.ms_forms_submitted_at
          ),
          'activity_history', COALESCE((
            SELECT jsonb_agg(ev ORDER BY ev->>'at')
            FROM (
              SELECT jsonb_build_object('event', 'registered', 'at', cr.created_at) AS ev
              UNION ALL
              SELECT jsonb_build_object('event', 'forms_submitted', 'at', cr.ms_forms_submitted_at)
              WHERE cr.ms_forms_submitted_at IS NOT NULL
            ) ev_rows
          ), '[]'::jsonb)
        )
        FROM public.customer_registrations cr WHERE cr.id = v_id
      )
    ) INTO v;
  END IF;
  RETURN v;
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.search_agents(text,text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.get_agent_details(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.search_leads(text,text,text,text,text,text,text,uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.get_lead_details(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.search_customers(text,text,text,text,text,text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.get_customer_details(text,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.clamp_search_limit(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.assert_meaningful_search_filter(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.normalize_phone_search(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.evidence_ref(text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.resolve_agent_business_id(text) FROM PUBLIC;

COMMENT ON FUNCTION wam_ai.search_agents IS 'MCP: wam.business.operations.search_agents';
COMMENT ON FUNCTION wam_ai.get_agent_details IS 'MCP: wam.business.operations.get_agent_details';
COMMENT ON FUNCTION wam_ai.search_leads IS 'MCP: wam.business.operations.search_leads';
COMMENT ON FUNCTION wam_ai.get_lead_details IS 'MCP: wam.business.operations.get_lead_details';
COMMENT ON FUNCTION wam_ai.search_customers IS 'MCP: wam.business.operations.search_customers';
COMMENT ON FUNCTION wam_ai.get_customer_details IS 'MCP: wam.business.operations.get_customer_details';

-- Future role grants (NOT executed as CREATE ROLE here):
-- GRANT EXECUTE ON FUNCTION wam_ai.search_agents(text,text,text,text,text,integer) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_agent_details(uuid,text) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.search_leads(text,text,text,text,text,text,text,uuid,text,integer) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_lead_details(uuid,text,text,text) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.search_customers(text,text,text,text,text,text,uuid,integer) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_customer_details(text,uuid,text,text,text) TO wam_ai_business_readonly;
