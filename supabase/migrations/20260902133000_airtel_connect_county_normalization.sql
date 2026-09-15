-- Normalize county keys for registration rollout matching.
-- Fixes "Kiambu County" (working_place) not matching "Kiambu" (registration_county_modes).

CREATE OR REPLACE FUNCTION public.normalize_registration_county_key(p_county TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_county IS NULL OR btrim(p_county) = '' THEN NULL
    ELSE lower(regexp_replace(btrim(p_county), '\s+county\s*$', '', 'i'))
  END;
$$;

COMMENT ON FUNCTION public.normalize_registration_county_key(TEXT) IS
  'Canonical county key for rollout lookup: trim, lower, strip trailing " County".';

CREATE OR REPLACE FUNCTION public.get_my_registration_mode()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_agent_id UUID := auth.uid();
  v_county TEXT;
  v_county_key TEXT;
  v_global BOOLEAN;
  v_mode TEXT;
BEGIN
  IF v_agent_id IS NULL THEN
    RETURN jsonb_build_object(
      'mode', 'legacy_wam',
      'reason', 'unauthenticated'
    );
  END IF;

  SELECT coalesce(airtel_connect_rollout_enabled, FALSE)
  INTO v_global
  FROM public.registration_rollout_config
  LIMIT 1;

  IF NOT coalesce(v_global, FALSE) THEN
    RETURN jsonb_build_object(
      'mode', 'legacy_wam',
      'reason', 'global_kill_switch',
      'global_enabled', FALSE
    );
  END IF;

  v_county := public.resolve_agent_registration_county(v_agent_id);
  v_county_key := public.normalize_registration_county_key(v_county);

  IF v_county_key IS NULL THEN
    RETURN jsonb_build_object(
      'mode', 'legacy_wam',
      'reason', 'no_trusted_county',
      'global_enabled', TRUE,
      'county', NULL
    );
  END IF;

  SELECT rcm.registration_mode
  INTO v_mode
  FROM public.registration_county_modes rcm
  WHERE public.normalize_registration_county_key(rcm.county) = v_county_key;

  IF v_mode = 'airtel_connect' THEN
    RETURN jsonb_build_object(
      'mode', 'airtel_connect',
      'county', v_county,
      'global_enabled', TRUE
    );
  END IF;

  RETURN jsonb_build_object(
    'mode', 'legacy_wam',
    'reason', 'county_not_enabled',
    'county', v_county,
    'global_enabled', TRUE
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_my_registration_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_registration_mode() TO authenticated;
