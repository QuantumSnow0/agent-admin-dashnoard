-- =============================================================================
-- WAM APPS AI Phase 1A.4 — agent business-reference hotfix (production additive)
-- Fixes: min(uuid) crash, case-sensitive safe-reference comparisons, duplicated
-- resolver semantics. Production-only apply; does not connect to production here.
-- =============================================================================

-- Canonical uppercase safe reference: A-XXXXXXXX (8 hex). Rejects raw UUID strings.
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

COMMENT ON FUNCTION wam_ai.normalize_agent_business_ref(text) IS
  'Parse safe agent business reference to canonical A-XXXXXXXX uppercase form; NULL when invalid or raw UUID.';

CREATE OR REPLACE FUNCTION wam_ai.agent_business_id(p_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT 'A-' || upper(left(replace(p_id::text, '-', ''), 8));
$fn$;

COMMENT ON FUNCTION wam_ai.agent_business_id(uuid) IS
  'Canonical safe agent business reference derived from internal UUID prefix (uppercase hex).';

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

CREATE OR REPLACE FUNCTION wam_ai.resolve_agent_id_from_business_ref(p_ref text)
RETURNS uuid
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT a.id
  FROM public.agents a
  WHERE wam_ai.agent_business_id(a.id) = wam_ai.normalize_agent_business_ref(p_ref)
  ORDER BY a.id
  LIMIT 1;
$fn$;

-- get_agent_details: replace min(uuid) with count + deterministic ORDER BY id LIMIT 1
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

REVOKE ALL ON FUNCTION wam_ai.normalize_agent_business_ref(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._resolve_agent_for_action(uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION wam_ai.normalize_agent_business_ref(text) IS
  'Phase 1A.4 hotfix: canonical safe agent reference parser (case-insensitive input, uppercase output).';
