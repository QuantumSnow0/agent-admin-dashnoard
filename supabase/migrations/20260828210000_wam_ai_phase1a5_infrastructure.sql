-- =============================================================================
-- WAM APPS AI Phase 1A.5 — operational action infrastructure (additive)
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai._clamp_service_radius_km(p_value double precision)
RETURNS double precision
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN p_value IS NULL OR NOT (p_value > 0) THEN NULL
    ELSE round(LEAST(50.0, GREATEST(0.5, p_value))::numeric, 1)::double precision
  END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._resolve_offer_for_action(
  p_offer_id uuid,
  p_offer_ref text,
  OUT v_offer_id uuid,
  OUT v_error jsonb
)
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_ref text := NULLIF(upper(btrim(p_offer_ref)), '');
  v_count integer;
BEGIN
  v_offer_id := p_offer_id;
  IF v_offer_id IS NULL AND v_ref IS NULL THEN
    v_error := jsonb_build_object(
      'status', 'error', 'error_category', 'validation',
      'message', 'offer_id or offer_ref is required');
    RETURN;
  END IF;

  IF v_ref ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' THEN
    v_error := jsonb_build_object(
      'status', 'error', 'error_category', 'validation',
      'message', 'Raw offer UUID is not accepted; use safe offer_reference');
    RETURN;
  END IF;

  IF v_ref IS NOT NULL AND v_ref !~ '^O-[0-9A-F]{12}$' THEN
    v_error := jsonb_build_object(
      'status', 'error', 'error_category', 'validation',
      'message', 'offer_reference must match O- followed by 12 hex characters');
    RETURN;
  END IF;

  IF v_offer_id IS NOT NULL AND v_ref IS NOT NULL
     AND upper(wam_ai.offer_ref(v_offer_id)) <> v_ref THEN
    v_error := jsonb_build_object(
      'status', 'ambiguous', 'error_category', 'ambiguous_match',
      'message', 'offer_id and offer_reference refer to different offers');
    RETURN;
  END IF;

  IF v_offer_id IS NULL THEN
    SELECT count(*)::int INTO v_count
    FROM public.lead_offers o
    WHERE upper(wam_ai.offer_ref(o.id)) = v_ref;

    IF v_count = 0 THEN
      v_error := jsonb_build_object(
        'status', 'not_found', 'error_category', 'not_found',
        'message', 'Lead offer not found');
      RETURN;
    END IF;
    IF v_count > 1 THEN
      v_error := jsonb_build_object(
        'status', 'ambiguous', 'error_category', 'ambiguous_match',
        'message', 'offer_reference matches multiple offers',
        'match_count', v_count);
      RETURN;
    END IF;

    SELECT o.id INTO v_offer_id
    FROM public.lead_offers o
    WHERE upper(wam_ai.offer_ref(o.id)) = v_ref;
  END IF;

  v_error := NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.offer_action_fingerprint(
  p_offer_id uuid,
  p_operation text,
  p_actor_id text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT encode(
    extensions.digest(
      coalesce(p_offer_id::text, '') || ':' ||
      coalesce(NULLIF(btrim(p_operation), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_actor_id), ''), ''),
      'sha256'
    ),
    'hex'
  );
$fn$;

REVOKE ALL ON FUNCTION wam_ai._clamp_service_radius_km(double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._resolve_offer_for_action(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.offer_action_fingerprint(uuid, text, text) FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN (
        '_clamp_service_radius_km',
        '_resolve_offer_for_action',
        'offer_action_fingerprint'
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
