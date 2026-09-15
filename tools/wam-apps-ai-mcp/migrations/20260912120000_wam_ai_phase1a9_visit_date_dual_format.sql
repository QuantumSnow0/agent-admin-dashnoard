-- WAM AI Phase 1A.9 visit_date dual-format remediation (forward-only)
-- Package: wam-apps-ai-mcp v0.1.21
--
-- Root cause: v0.1.20 / Phase 1A.9 migration only accepted TEXT visit_date as M/d/yyyy.
-- Production customer_registrations.visit_date values are ISO YYYY-MM-DD, so relative
-- visit_day / this_week / next-week-style filters returned false zero counts.
--
-- This migration REPLACE-s the fail-closed parser in place. Do NOT re-apply
-- 20260910120000_wam_ai_phase1a9_semantic_query.sql on production.
-- Does NOT modify Phase 1A.8 reconciliation / SMS / action semantics.
--
-- Parsing policy (documented):
--   * Leading/trailing whitespace trimmed via btrim; empty → NULL
--   * Accepted forms only:
--       - M/d/yyyy with 1–2 digit month/day and 4-digit year (slash separators)
--       - ISO YYYY-MM-DD with exact 4-2-2 digit widths (hyphen separators)
--   * Strict calendar validation via make_date + component round-trip
--   * Invalid / malformed / impossible dates → NULL (fail-closed; no match)
--   * Never cast via ::date / to_date (avoid silent normalization)
--   * Never substitute created_at when visit_date was requested

CREATE OR REPLACE FUNCTION wam_ai._query_parse_mdy_date(p_raw text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s text;
  v_m int;
  v_d int;
  v_y int;
  v_dt date;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;

  v_s := btrim(p_raw);
  IF v_s = '' THEN
    RETURN NULL;
  END IF;

  IF v_s ~ '^\d{4}-\d{2}-\d{2}$' THEN
    -- Strict ISO YYYY-MM-DD (zero-padded month/day required)
    v_y := substr(v_s, 1, 4)::int;
    v_m := substr(v_s, 6, 2)::int;
    v_d := substr(v_s, 9, 2)::int;
  ELSIF v_s ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
    -- M/d/yyyy (one- or two-digit month/day)
    v_m := split_part(v_s, '/', 1)::int;
    v_d := split_part(v_s, '/', 2)::int;
    v_y := split_part(v_s, '/', 3)::int;
  ELSE
    RETURN NULL;
  END IF;

  IF v_m < 1 OR v_m > 12 OR v_d < 1 OR v_d > 31 OR v_y < 1900 OR v_y > 2100 THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_dt := make_date(v_y, v_m, v_d);
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  -- Defense in depth: reject any unexpected normalization
  IF extract(year FROM v_dt)::int IS DISTINCT FROM v_y
     OR extract(month FROM v_dt)::int IS DISTINCT FROM v_m
     OR extract(day FROM v_dt)::int IS DISTINCT FROM v_d THEN
    RETURN NULL;
  END IF;

  RETURN v_dt;
END;
$fn$;

COMMENT ON FUNCTION wam_ai._query_parse_mdy_date(text) IS
  'Fail-closed dual-format parser for customer_registrations.visit_date TEXT: M/d/yyyy or ISO YYYY-MM-DD; NULL on invalid. Name retained for privilege/gate compatibility.';

-- Catalogue notes / version bump (describe RPC only; query RPCs unchanged)
CREATE OR REPLACE FUNCTION wam_ai.describe_business_query_catalogue(
  p_dataset text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ds text := NULLIF(lower(btrim(coalesce(p_dataset, ''))), '');
BEGIN
  IF v_ds IS NOT NULL AND v_ds NOT IN (
    'agents', 'customer_registrations', 'inbound_leads', 'safaricom_registrations'
  ) THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error_category', 'invalid_dataset',
      'message', 'Unknown dataset'
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'catalogue_version', '1a9.2',
    'timezone', 'Africa/Nairobi',
    'datasets', (
      SELECT coalesce(jsonb_agg(d ORDER BY d->>'id'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id', x.id,
          'notes', x.notes
        ) AS d
        FROM (VALUES
          ('agents', 'joined means created_at; approved_at does not exist'),
          ('customer_registrations', 'visit_date is TEXT M/d/yyyy or ISO YYYY-MM-DD; parsed fail-closed; never substitute created_at'),
          ('inbound_leads', 'visit_date is native DATE'),
          ('safaricom_registrations', 'no visit_date field')
        ) AS x(id, notes)
        WHERE v_ds IS NULL OR x.id = v_ds
      ) s
    ),
    'model_guidance', jsonb_build_object(
      'mcp_accepts_structured_json_only', true,
      'never_guess_dataset', true,
      'never_substitute_created_at_for_visit_date', true,
      'visit_date_text_formats', jsonb_build_array('M/d/yyyy', 'YYYY-MM-DD')
    )
  );
END;
$fn$;

-- Privilege boundaries unchanged: helpers remain ungranted; public RPCs keep existing grants.
REVOKE ALL ON FUNCTION wam_ai._query_parse_mdy_date(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.describe_business_query_catalogue(text) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    GRANT EXECUTE ON FUNCTION wam_ai.describe_business_query_catalogue(text) TO wam_ai_business_readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    REVOKE ALL ON FUNCTION wam_ai.describe_business_query_catalogue(text) FROM wam_ai_business_actions;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION wam_ai.describe_business_query_catalogue(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION wam_ai.describe_business_query_catalogue(text) FROM authenticated;
  END IF;
END;
$grant$;
