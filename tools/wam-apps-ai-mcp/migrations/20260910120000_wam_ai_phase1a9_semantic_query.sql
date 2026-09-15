-- WAM AI Phase 1A.9 — semantic structured business query (read-only)
-- Namespace: wam.business.query
-- Tools: describe_business_query_catalogue | list_business_records | aggregate_business_metrics
-- Constraints:
--   * Structured JSON only (no arbitrary SQL from callers)
--   * Allowlisted datasets/fields/ops/aggregates
--   * Parameterized typed SQL only
--   * SECURITY DEFINER + fixed search_path
--   * EXECUTE granted only to wam_ai_business_readonly
--   * No SELECT grants on public base tables
--   * Africa/Nairobi half-open date ranges
--   * customer_registrations.visit_date TEXT M/d/yyyy parsed fail-closed
--   * Never substitute created_at for visit_date
-- Does NOT modify Phase 1A.8 reconciliation semantics.

CREATE SCHEMA IF NOT EXISTS wam_ai;

-- ---------------------------------------------------------------------------
-- Helpers (private — not granted to login roles)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION wam_ai._query_parse_mdy_date(p_raw text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_m int;
  v_d int;
  v_y int;
  v_dt date;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN
    RETURN NULL;
  END IF;
  IF btrim(p_raw) !~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
    RETURN NULL;
  END IF;
  v_m := split_part(btrim(p_raw), '/', 1)::int;
  v_d := split_part(btrim(p_raw), '/', 2)::int;
  v_y := split_part(btrim(p_raw), '/', 3)::int;
  IF v_m < 1 OR v_m > 12 OR v_d < 1 OR v_d > 31 OR v_y < 1900 OR v_y > 2100 THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_dt := make_date(v_y, v_m, v_d);
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN v_dt;
END;
$fn$;

COMMENT ON FUNCTION wam_ai._query_parse_mdy_date(text) IS
  'Fail-closed M/d/yyyy parser for customer_registrations.visit_date; NULL on invalid.';

CREATE OR REPLACE FUNCTION wam_ai._query_nairobi_relative_range(p_period text)
RETURNS TABLE(start_ts timestamptz, end_ts timestamptz, start_date date, end_date date)
LANGUAGE plpgsql
STABLE
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_today date := (timezone('Africa/Nairobi', now()))::date;
  v_start date;
  v_end date;
  v_dow int;
BEGIN
  CASE lower(btrim(coalesce(p_period, '')))
    WHEN 'today' THEN
      v_start := v_today;
      v_end := v_today + 1;
    WHEN 'yesterday' THEN
      v_start := v_today - 1;
      v_end := v_today;
    WHEN 'this_week' THEN
      v_dow := extract(isodow from v_today)::int; -- 1=Mon .. 7=Sun
      v_start := v_today - (v_dow - 1);
      v_end := v_start + 7;
    WHEN 'last_week' THEN
      v_dow := extract(isodow from v_today)::int;
      v_end := v_today - (v_dow - 1);
      v_start := v_end - 7;
    WHEN 'this_month' THEN
      v_start := date_trunc('month', v_today)::date;
      v_end := (date_trunc('month', v_today) + interval '1 month')::date;
    WHEN 'last_month' THEN
      v_end := date_trunc('month', v_today)::date;
      v_start := (date_trunc('month', v_today) - interval '1 month')::date;
    ELSE
      RAISE EXCEPTION 'invalid_relative_period';
  END CASE;

  start_ts := (v_start::text || ' 00:00:00+03')::timestamptz;
  end_ts := (v_end::text || ' 00:00:00+03')::timestamptz;
  start_date := v_start;
  end_date := v_end;
  RETURN NEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._query_resolve_field_expr(
  p_dataset text,
  p_field text,
  p_for_filter boolean DEFAULT true
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ds text := lower(btrim(coalesce(p_dataset, '')));
  v_f text := lower(btrim(coalesce(p_field, '')));
BEGIN
  -- Returns a trusted SQL expression fragment (never caller-concatenated identifiers).
  IF v_ds = 'agents' THEN
    RETURN CASE v_f
      WHEN 'created_at' THEN 'a.created_at'
      WHEN 'status' THEN 'a.status'
      WHEN 'name' THEN 'a.name'
      WHEN 'email' THEN 'a.email'
      WHEN 'airtel_phone' THEN 'a.airtel_phone'
      WHEN 'safaricom_phone' THEN 'a.safaricom_phone'
      WHEN 'town' THEN 'a.town'
      WHEN 'area' THEN 'a.area'
      WHEN 'id' THEN CASE WHEN p_for_filter THEN NULL ELSE 'a.id' END
      ELSE NULL
    END;
  ELSIF v_ds = 'customer_registrations' THEN
    RETURN CASE v_f
      WHEN 'created_at' THEN 'cr.created_at'
      WHEN 'visit_date' THEN 'wam_ai._query_parse_mdy_date(cr.visit_date)'
      WHEN 'visit_time' THEN CASE WHEN p_for_filter THEN NULL ELSE 'cr.visit_time' END
      WHEN 'status' THEN 'cr.status'
      WHEN 'customer_name' THEN 'cr.customer_name'
      WHEN 'airtel_number' THEN 'cr.airtel_number'
      WHEN 'alternate_number' THEN 'cr.alternate_number'
      WHEN 'preferred_package' THEN 'cr.preferred_package'
      WHEN 'installation_town' THEN 'cr.installation_town'
      WHEN 'id' THEN CASE WHEN p_for_filter THEN NULL ELSE 'cr.id' END
      ELSE NULL
    END;
  ELSIF v_ds = 'inbound_leads' THEN
    RETURN CASE v_f
      WHEN 'created_at' THEN 'l.created_at'
      WHEN 'visit_date' THEN 'l.visit_date'
      WHEN 'visit_time' THEN CASE WHEN p_for_filter THEN NULL ELSE 'l.visit_time' END
      WHEN 'installed_at' THEN 'l.installed_at'
      WHEN 'status' THEN 'l.status'
      WHEN 'customer_name' THEN 'l.customer_name'
      WHEN 'primary_phone' THEN 'l.primary_phone'
      WHEN 'alternate_phone' THEN 'l.alternate_phone'
      WHEN 'county' THEN 'l.county'
      WHEN 'installation_town' THEN 'l.installation_town'
      WHEN 'product' THEN 'l.product'
      WHEN 'preferred_package' THEN 'l.preferred_package'
      WHEN 'id' THEN CASE WHEN p_for_filter THEN NULL ELSE 'l.id' END
      ELSE NULL
    END;
  ELSIF v_ds = 'safaricom_registrations' THEN
    RETURN CASE v_f
      WHEN 'created_at' THEN 'sr.created_at'
      WHEN 'status' THEN 'sr.status'
      WHEN 'customer_name' THEN 'sr.customer_name'
      WHEN 'safaricom_number' THEN 'sr.safaricom_number'
      WHEN 'alternate_number' THEN 'sr.alternate_number'
      WHEN 'service_package' THEN 'sr.service_package'
      WHEN 'install_county' THEN 'sr.install_county'
      WHEN 'install_town' THEN 'sr.install_town'
      WHEN 'id' THEN CASE WHEN p_for_filter THEN NULL ELSE 'sr.id' END
      ELSE NULL
    END;
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._query_field_kind(p_dataset text, p_field text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_field IN ('created_at', 'installed_at') THEN 'timestamptz'
    WHEN p_dataset = 'customer_registrations' AND p_field = 'visit_date' THEN 'date_text_mdy'
    WHEN p_field = 'visit_date' THEN 'date'
    ELSE 'text'
  END;
$fn$;

-- Build AND clauses from allowlisted filters.
-- User-derived values are NEVER interpolated into SQL text.
-- They are appended to a JSONB bind array and referenced as ($1->>N) / ($1->N)
-- with typed casts; EXECUTE ... USING v_binds supplies the single JSONB parameter.
-- format(%s) / fixed integers are used only for allowlisted expressions and bind indices.
DROP FUNCTION IF EXISTS wam_ai._query_apply_filters(text, jsonb, text, text[]);

CREATE OR REPLACE FUNCTION wam_ai._query_apply_filters(
  p_dataset text,
  p_filters jsonb,
  p_sql text,
  p_binds jsonb
) RETURNS TABLE(out_sql text, out_binds jsonb)
LANGUAGE plpgsql
STABLE
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_f jsonb;
  v_field text;
  v_op text;
  v_expr text;
  v_kind text;
  v_rel record;
  v_period text;
  v_arr jsonb;
  v_sql text := coalesce(p_sql, ' WHERE TRUE');
  v_binds jsonb := coalesce(p_binds, '[]'::jsonb);
  v_val text;
  v_idx int;
  v_idx2 int;
BEGIN
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'array' THEN
    RAISE EXCEPTION 'invalid_filters';
  END IF;
  IF jsonb_array_length(p_filters) > 12 THEN
    RAISE EXCEPTION 'too_many_filters';
  END IF;

  FOR v_f IN SELECT * FROM jsonb_array_elements(p_filters)
  LOOP
    v_field := lower(btrim(coalesce(v_f->>'field', '')));
    v_op := lower(btrim(coalesce(v_f->>'op', '')));
    v_expr := wam_ai._query_resolve_field_expr(p_dataset, v_field, true);
    IF v_expr IS NULL THEN
      RAISE EXCEPTION 'invalid_filter_field';
    END IF;
    v_kind := wam_ai._query_field_kind(p_dataset, v_field);

    IF v_op = 'eq' THEN
      v_val := coalesce(v_f->>'value', '');
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(v_val));
      v_sql := v_sql || format(' AND %s::text = ($1->>%s)', v_expr, v_idx);
    ELSIF v_op = 'neq' THEN
      v_val := coalesce(v_f->>'value', '');
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(v_val));
      v_sql := v_sql || format(' AND %s::text IS DISTINCT FROM ($1->>%s)', v_expr, v_idx);
    ELSIF v_op = 'is_null' THEN
      v_sql := v_sql || format(' AND %s IS NULL', v_expr);
    ELSIF v_op = 'is_not_null' THEN
      v_sql := v_sql || format(' AND %s IS NOT NULL', v_expr);
    ELSIF v_op = 'gt' THEN
      v_val := coalesce(v_f->>'value', '');
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(v_val));
      IF v_kind = 'timestamptz' THEN
        v_sql := v_sql || format(' AND %s > ($1->>%s)::timestamptz', v_expr, v_idx);
      ELSIF v_kind IN ('date', 'date_text_mdy') THEN
        v_sql := v_sql || format(' AND %s > ($1->>%s)::date', v_expr, v_idx);
      ELSE
        RAISE EXCEPTION 'invalid_op_for_field';
      END IF;
    ELSIF v_op = 'gte' THEN
      v_val := coalesce(v_f->>'value', '');
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(v_val));
      IF v_kind = 'timestamptz' THEN
        v_sql := v_sql || format(' AND %s >= ($1->>%s)::timestamptz', v_expr, v_idx);
      ELSIF v_kind IN ('date', 'date_text_mdy') THEN
        v_sql := v_sql || format(' AND %s >= ($1->>%s)::date', v_expr, v_idx);
      ELSE
        RAISE EXCEPTION 'invalid_op_for_field';
      END IF;
    ELSIF v_op = 'lt' THEN
      v_val := coalesce(v_f->>'value', '');
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(v_val));
      IF v_kind = 'timestamptz' THEN
        v_sql := v_sql || format(' AND %s < ($1->>%s)::timestamptz', v_expr, v_idx);
      ELSIF v_kind IN ('date', 'date_text_mdy') THEN
        v_sql := v_sql || format(' AND %s < ($1->>%s)::date', v_expr, v_idx);
      ELSE
        RAISE EXCEPTION 'invalid_op_for_field';
      END IF;
    ELSIF v_op = 'lte' THEN
      v_val := coalesce(v_f->>'value', '');
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(v_val));
      IF v_kind = 'timestamptz' THEN
        v_sql := v_sql || format(' AND %s <= ($1->>%s)::timestamptz', v_expr, v_idx);
      ELSIF v_kind IN ('date', 'date_text_mdy') THEN
        v_sql := v_sql || format(' AND %s <= ($1->>%s)::date', v_expr, v_idx);
      ELSE
        RAISE EXCEPTION 'invalid_op_for_field';
      END IF;
    ELSIF v_op = 'between' THEN
      v_arr := v_f->'value';
      IF jsonb_typeof(v_arr) <> 'array' OR jsonb_array_length(v_arr) <> 2 THEN
        RAISE EXCEPTION 'invalid_between';
      END IF;
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(coalesce(v_arr->>0, '')));
      v_idx2 := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(coalesce(v_arr->>1, '')));
      IF v_kind = 'timestamptz' THEN
        v_sql := v_sql || format(
          ' AND %s >= ($1->>%s)::timestamptz AND %s < ($1->>%s)::timestamptz',
          v_expr, v_idx, v_expr, v_idx2
        );
      ELSIF v_kind IN ('date', 'date_text_mdy') THEN
        v_sql := v_sql || format(
          ' AND %s >= ($1->>%s)::date AND %s < ($1->>%s)::date',
          v_expr, v_idx, v_expr, v_idx2
        );
      ELSE
        RAISE EXCEPTION 'invalid_op_for_field';
      END IF;
    ELSIF v_op IN ('in', 'not_in') THEN
      v_arr := v_f->'value';
      IF jsonb_typeof(v_arr) <> 'array' OR jsonb_array_length(v_arr) < 1 OR jsonb_array_length(v_arr) > 50 THEN
        RAISE EXCEPTION 'invalid_in_list';
      END IF;
      -- Bind entire IN-list as one JSONB array element; expand via jsonb_array_elements_text($1->N)
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(v_arr);
      IF v_op = 'in' THEN
        v_sql := v_sql || format(
          ' AND %s::text = ANY (ARRAY(SELECT jsonb_array_elements_text($1->%s)))',
          v_expr, v_idx
        );
      ELSE
        v_sql := v_sql || format(
          ' AND %s::text <> ALL (ARRAY(SELECT jsonb_array_elements_text($1->%s)))',
          v_expr, v_idx
        );
      END IF;
    ELSIF v_op = 'ilike_prefix' THEN
      IF coalesce(v_f->>'value', '') ~ '[%_]' THEN
        RAISE EXCEPTION 'invalid_ilike_prefix';
      END IF;
      v_val := coalesce(v_f->>'value', '') || '%';
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(v_val));
      v_sql := v_sql || format(' AND %s ILIKE ($1->>%s)', v_expr, v_idx);
    ELSIF v_op = 'eq_calendar_date' THEN
      IF coalesce(v_f->>'value', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'invalid_calendar_date';
      END IF;
      v_val := v_f->>'value';
      v_idx := jsonb_array_length(v_binds);
      v_binds := v_binds || jsonb_build_array(to_jsonb(v_val));
      IF v_kind = 'timestamptz' THEN
        v_sql := v_sql || format(
          ' AND (%s AT TIME ZONE ''Africa/Nairobi'')::date = ($1->>%s)::date',
          v_expr, v_idx
        );
      ELSIF v_kind IN ('date', 'date_text_mdy') THEN
        v_sql := v_sql || format(' AND %s = ($1->>%s)::date', v_expr, v_idx);
      ELSE
        RAISE EXCEPTION 'invalid_op_for_field';
      END IF;
    ELSIF v_op = 'relative_range' OR v_op = 'date_trunc_eq' THEN
      IF v_op = 'date_trunc_eq' THEN
        IF (v_f->'value'->>'grain') IS DISTINCT FROM 'month'
           OR (v_f->'value'->>'ref') IS DISTINCT FROM 'current' THEN
          RAISE EXCEPTION 'invalid_date_trunc_eq';
        END IF;
        v_period := 'this_month';
      ELSE
        v_period := lower(btrim(coalesce(v_f->>'value', '')));
      END IF;
      -- Bounds computed server-side from allowlisted period; still bound (not interpolated).
      SELECT * INTO v_rel FROM wam_ai._query_nairobi_relative_range(v_period);
      IF v_kind = 'timestamptz' THEN
        v_idx := jsonb_array_length(v_binds);
        v_binds := v_binds || jsonb_build_array(to_jsonb(v_rel.start_ts::text));
        v_idx2 := jsonb_array_length(v_binds);
        v_binds := v_binds || jsonb_build_array(to_jsonb(v_rel.end_ts::text));
        v_sql := v_sql || format(
          ' AND %s >= ($1->>%s)::timestamptz AND %s < ($1->>%s)::timestamptz',
          v_expr, v_idx, v_expr, v_idx2
        );
      ELSIF v_kind IN ('date', 'date_text_mdy') THEN
        v_idx := jsonb_array_length(v_binds);
        v_binds := v_binds || jsonb_build_array(to_jsonb(v_rel.start_date::text));
        v_idx2 := jsonb_array_length(v_binds);
        v_binds := v_binds || jsonb_build_array(to_jsonb(v_rel.end_date::text));
        v_sql := v_sql || format(
          ' AND %s >= ($1->>%s)::date AND %s < ($1->>%s)::date',
          v_expr, v_idx, v_expr, v_idx2
        );
      ELSE
        RAISE EXCEPTION 'invalid_op_for_field';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid_filter_op';
    END IF;
  END LOOP;

  out_sql := v_sql;
  out_binds := v_binds;
  RETURN NEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._query_from_clause(p_dataset text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN CASE lower(btrim(p_dataset))
    WHEN 'agents' THEN 'public.agents a'
    WHEN 'customer_registrations' THEN 'public.customer_registrations cr'
    WHEN 'inbound_leads' THEN 'public.inbound_leads l'
    WHEN 'safaricom_registrations' THEN 'public.safaricom_registrations sr'
    ELSE NULL
  END;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._query_business_ref_expr(p_dataset text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
  SELECT CASE lower(btrim(p_dataset))
    WHEN 'agents' THEN 'wam_ai.agent_business_id(a.id)'
    WHEN 'customer_registrations' THEN 'wam_ai.registration_ref(cr.id)'
    WHEN 'inbound_leads' THEN 'wam_ai.lead_ref(l.id)'
    WHEN 'safaricom_registrations' THEN 'wam_ai.registration_ref(sr.id)'
    ELSE NULL
  END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._query_pk_alias(p_dataset text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
  SELECT CASE lower(btrim(p_dataset))
    WHEN 'agents' THEN 'a'
    WHEN 'customer_registrations' THEN 'cr'
    WHEN 'inbound_leads' THEN 'l'
    WHEN 'safaricom_registrations' THEN 'sr'
    ELSE NULL
  END;
$fn$;

-- ---------------------------------------------------------------------------
-- Public catalogue RPC (parity with TypeScript; MCP may use TS directly)
-- ---------------------------------------------------------------------------

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
    'catalogue_version', '1a9.1',
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
          ('customer_registrations', 'visit_date is TEXT M/d/yyyy; parsed fail-closed; never substitute created_at'),
          ('inbound_leads', 'visit_date is native DATE'),
          ('safaricom_registrations', 'no visit_date field')
        ) AS x(id, notes)
        WHERE v_ds IS NULL OR x.id = v_ds
      ) s
    ),
    'model_guidance', jsonb_build_object(
      'mcp_accepts_structured_json_only', true,
      'never_guess_dataset', true,
      'never_substitute_created_at_for_visit_date', true
    )
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- list_business_records
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION wam_ai.list_business_records(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_dataset text;
  v_mode text;
  v_limit int;
  v_offset int;
  v_from text;
  v_ref text;
  v_alias text;
  v_filters jsonb;
  v_select jsonb;
  v_sort jsonb;
  v_where text := ' WHERE TRUE';
  v_binds jsonb := '[]'::jsonb;
  v_sql text;
  v_count_sql text;
  v_total bigint;
  v_rows jsonb := '[]'::jsonb;
  v_sel_parts text := '';
  v_field text;
  v_expr text;
  v_sort_sql text := '';
  v_s jsonb;
  v_dir text;
  v_rec record;
  v_row jsonb;
  v_started timestamptz := clock_timestamp();
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Invalid request');
  END IF;
  IF p_request ? 'sql' OR p_request ? 'query' OR p_request ? 'rawSql' THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'denied', 'message', 'Arbitrary SQL is not allowed');
  END IF;
  IF p_request ? 'joins' AND jsonb_typeof(p_request->'joins') = 'array'
     AND jsonb_array_length(p_request->'joins') > 0 THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_join', 'message', 'Joins are not enabled in Phase 1A.9');
  END IF;

  v_dataset := lower(btrim(coalesce(p_request->>'dataset', '')));
  v_from := wam_ai._query_from_clause(v_dataset);
  IF v_from IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_dataset', 'message', 'Unknown dataset');
  END IF;
  v_ref := wam_ai._query_business_ref_expr(v_dataset);
  v_alias := wam_ai._query_pk_alias(v_dataset);

  v_mode := lower(btrim(coalesce(p_request->>'response_mode', 'summary')));
  IF v_mode NOT IN ('number_only', 'summary', 'detailed') THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Invalid response_mode');
  END IF;

  v_limit := least(greatest(coalesce((p_request->>'limit')::int, 50), 1), 100);
  v_offset := least(greatest(coalesce((p_request->>'offset')::int, 0), 0), 10000);

  v_filters := coalesce(p_request->'filters', '[]'::jsonb);
  BEGIN
    SELECT f.out_sql, f.out_binds INTO v_where, v_binds
    FROM wam_ai._query_apply_filters(v_dataset, v_filters, v_where, v_binds) AS f;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error_category', 'validation',
      'message', 'Invalid filters'
    );
  END;

  -- SELECT projection (never expose internal UUID id)
  v_sel_parts := format('%s AS business_ref', v_ref);
  v_select := p_request->'select';
  IF v_select IS NULL OR jsonb_typeof(v_select) <> 'array' OR jsonb_array_length(v_select) = 0 THEN
    -- default selectable fields (exclude id)
    IF v_dataset = 'agents' THEN
      v_select := '["created_at","status","name","email","airtel_phone","safaricom_phone","town","area"]'::jsonb;
    ELSIF v_dataset = 'customer_registrations' THEN
      v_select := '["created_at","visit_date","visit_time","status","customer_name","airtel_number","alternate_number","preferred_package","installation_town"]'::jsonb;
    ELSIF v_dataset = 'inbound_leads' THEN
      v_select := '["created_at","visit_date","visit_time","installed_at","status","customer_name","primary_phone","alternate_phone","county","installation_town","product","preferred_package"]'::jsonb;
    ELSE
      v_select := '["created_at","status","customer_name","safaricom_number","alternate_number","service_package","install_county","install_town"]'::jsonb;
    END IF;
  END IF;
  IF jsonb_array_length(v_select) > 24 THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Too many select fields');
  END IF;

  FOR v_field IN SELECT jsonb_array_elements_text(v_select)
  LOOP
    IF v_field = 'id' THEN
      RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_field', 'message', 'Internal ids are not selectable');
    END IF;
    v_expr := wam_ai._query_resolve_field_expr(v_dataset, v_field, false);
    IF v_expr IS NULL OR v_expr LIKE '%.id' THEN
      RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_field', 'message', 'Unknown select field');
    END IF;
    -- For visit_date on CR, expose original text plus parsed date when detailed
    IF v_dataset = 'customer_registrations' AND v_field = 'visit_date' THEN
      v_sel_parts := v_sel_parts || format(', cr.visit_date AS visit_date, wam_ai._query_parse_mdy_date(cr.visit_date) AS visit_date_parsed');
    ELSE
      v_sel_parts := v_sel_parts || format(', %s AS %I', v_expr, v_field);
    END IF;
  END LOOP;

  -- Deterministic sort
  v_sort := p_request->'sort';
  IF v_sort IS NULL OR jsonb_typeof(v_sort) <> 'array' OR jsonb_array_length(v_sort) = 0 THEN
    v_sort_sql := format(' ORDER BY %s.created_at DESC, %s.id ASC', v_alias, v_alias);
  ELSE
    IF jsonb_array_length(v_sort) > 2 THEN
      RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Too many sort fields');
    END IF;
    v_sort_sql := ' ORDER BY ';
    FOR v_s IN SELECT * FROM jsonb_array_elements(v_sort)
    LOOP
      v_field := lower(btrim(coalesce(v_s->>'field', '')));
      v_dir := lower(btrim(coalesce(v_s->>'dir', 'asc')));
      IF v_dir NOT IN ('asc', 'desc') THEN
        RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_sort', 'message', 'Invalid sort direction');
      END IF;
      v_expr := wam_ai._query_resolve_field_expr(v_dataset, v_field, true);
      IF v_expr IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_sort', 'message', 'Invalid sort field');
      END IF;
      IF v_sort_sql <> ' ORDER BY ' THEN
        v_sort_sql := v_sort_sql || ', ';
      END IF;
      v_sort_sql := v_sort_sql || format('%s %s NULLS LAST', v_expr, v_dir);
    END LOOP;
    v_sort_sql := v_sort_sql || format(', %s.id ASC', v_alias);
  END IF;

  v_count_sql := format('SELECT count(*)::bigint FROM %s%s', v_from, v_where);
  IF v_where ~ '\$1' THEN
    EXECUTE v_count_sql INTO v_total USING v_binds;
  ELSE
    EXECUTE v_count_sql INTO v_total;
  END IF;

  IF v_mode = 'number_only' THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'dataset', v_dataset,
      'response_mode', v_mode,
      'total_count', v_total,
      'returned_row_count', 0,
      'number', v_total,
      'bound_value_count', jsonb_array_length(v_binds),
      'duration_ms', (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int
    );
  END IF;

  v_sql := format(
    'SELECT %s FROM %s%s%s LIMIT %s OFFSET %s',
    v_sel_parts, v_from, v_where, v_sort_sql, v_limit, v_offset
  );

  IF v_where ~ '\$1' THEN
    FOR v_rec IN EXECUTE v_sql USING v_binds
    LOOP
      v_row := to_jsonb(v_rec);
      v_row := v_row - 'id';
      v_rows := v_rows || jsonb_build_array(v_row);
    END LOOP;
  ELSE
    FOR v_rec IN EXECUTE v_sql
    LOOP
      v_row := to_jsonb(v_rec);
      v_row := v_row - 'id';
      v_rows := v_rows || jsonb_build_array(v_row);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'dataset', v_dataset,
    'response_mode', v_mode,
    'total_count', v_total,
    'returned_row_count', jsonb_array_length(v_rows),
    'limit', v_limit,
    'offset', v_offset,
    'rows', v_rows,
    'bound_value_count', jsonb_array_length(v_binds),
    'duration_ms', (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- aggregate_business_metrics
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION wam_ai.aggregate_business_metrics(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_dataset text;
  v_mode text;
  v_from text;
  v_alias text;
  v_filters jsonb;
  v_metrics jsonb;
  v_group jsonb;
  v_where text := ' WHERE TRUE';
  v_binds jsonb := '[]'::jsonb;
  v_metric jsonb;
  v_fn text;
  v_field text;
  v_alias_m text;
  v_expr text;
  v_agg_parts text := '';
  v_group_parts text := '';
  v_group_select text := '';
  v_i int := 0;
  v_sql text;
  v_rows jsonb := '[]'::jsonb;
  v_rec record;
  v_started timestamptz := clock_timestamp();
  v_limit int;
  v_number numeric;
  v_first_alias text;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Invalid request');
  END IF;
  IF p_request ? 'sql' OR p_request ? 'query' OR p_request ? 'rawSql' THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'denied', 'message', 'Arbitrary SQL is not allowed');
  END IF;
  IF p_request ? 'joins' AND jsonb_typeof(p_request->'joins') = 'array'
     AND jsonb_array_length(p_request->'joins') > 0 THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_join', 'message', 'Joins are not enabled in Phase 1A.9');
  END IF;

  v_dataset := lower(btrim(coalesce(p_request->>'dataset', '')));
  v_from := wam_ai._query_from_clause(v_dataset);
  IF v_from IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_dataset', 'message', 'Unknown dataset');
  END IF;
  v_alias := wam_ai._query_pk_alias(v_dataset);

  v_mode := lower(btrim(coalesce(p_request->>'response_mode', 'summary')));
  IF v_mode NOT IN ('number_only', 'summary', 'detailed') THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Invalid response_mode');
  END IF;

  v_limit := least(greatest(coalesce((p_request->>'limit')::int, 100), 1), 100);
  v_filters := coalesce(p_request->'filters', '[]'::jsonb);
  BEGIN
    SELECT f.out_sql, f.out_binds INTO v_where, v_binds
    FROM wam_ai._query_apply_filters(v_dataset, v_filters, v_where, v_binds) AS f;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Invalid filters');
  END;

  v_metrics := coalesce(p_request->'metrics', '[]'::jsonb);
  IF jsonb_typeof(v_metrics) <> 'array' OR jsonb_array_length(v_metrics) < 1
     OR jsonb_array_length(v_metrics) > 5 THEN
    RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Invalid metrics');
  END IF;

  FOR v_metric IN SELECT * FROM jsonb_array_elements(v_metrics)
  LOOP
    v_i := v_i + 1;
    v_fn := lower(btrim(coalesce(v_metric->>'fn', '')));
    v_field := lower(btrim(coalesce(v_metric->>'field', 'id')));
    v_alias_m := lower(btrim(coalesce(v_metric->>'alias', 'm' || v_i)));
    IF v_alias_m !~ '^[a-z][a-z0-9_]*$' THEN
      RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Invalid metric alias');
    END IF;
    IF v_i = 1 THEN
      v_first_alias := v_alias_m;
    END IF;

    IF v_fn = 'count' AND v_field = 'id' THEN
      v_expr := format('count(%s.id)', v_alias);
    ELSIF v_fn = 'count_distinct' AND v_field = 'id' THEN
      v_expr := format('count(DISTINCT %s.id)', v_alias);
    ELSE
      v_expr := wam_ai._query_resolve_field_expr(v_dataset, v_field, false);
      IF v_expr IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_field', 'message', 'Invalid aggregate field');
      END IF;
      IF v_fn = 'count' THEN
        v_expr := format('count(%s)', v_expr);
      ELSIF v_fn = 'count_distinct' THEN
        v_expr := format('count(DISTINCT %s)', v_expr);
      ELSIF v_fn = 'min' THEN
        v_expr := format('min(%s)', v_expr);
      ELSIF v_fn = 'max' THEN
        v_expr := format('max(%s)', v_expr);
      ELSE
        RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_aggregate', 'message', 'Unknown aggregate');
      END IF;
    END IF;

    IF v_agg_parts <> '' THEN
      v_agg_parts := v_agg_parts || ', ';
    END IF;
    v_agg_parts := v_agg_parts || format('%s AS %I', v_expr, v_alias_m);
  END LOOP;

  v_group := coalesce(p_request->'group_by', '[]'::jsonb);
  IF jsonb_typeof(v_group) = 'array' AND jsonb_array_length(v_group) > 0 THEN
    IF jsonb_array_length(v_group) > 3 THEN
      RETURN jsonb_build_object('status', 'error', 'error_category', 'validation', 'message', 'Too many group_by fields');
    END IF;
    FOR v_field IN SELECT jsonb_array_elements_text(v_group)
    LOOP
      v_expr := wam_ai._query_resolve_field_expr(v_dataset, v_field, true);
      IF v_expr IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'error_category', 'invalid_field', 'message', 'Invalid group_by field');
      END IF;
      IF v_group_parts <> '' THEN
        v_group_parts := v_group_parts || ', ';
        v_group_select := v_group_select || ', ';
      END IF;
      v_group_parts := v_group_parts || v_expr;
      v_group_select := v_group_select || format('%s AS %I', v_expr, v_field);
    END LOOP;
    v_sql := format(
      'SELECT %s, %s FROM %s%s GROUP BY %s ORDER BY %s LIMIT %s',
      v_group_select, v_agg_parts, v_from, v_where, v_group_parts, v_group_parts, v_limit
    );
  ELSE
    v_sql := format('SELECT %s FROM %s%s', v_agg_parts, v_from, v_where);
  END IF;

  IF v_where ~ '\$1' THEN
    FOR v_rec IN EXECUTE v_sql USING v_binds
    LOOP
      v_rows := v_rows || jsonb_build_array(to_jsonb(v_rec));
    END LOOP;
  ELSE
    FOR v_rec IN EXECUTE v_sql
    LOOP
      v_rows := v_rows || jsonb_build_array(to_jsonb(v_rec));
    END LOOP;
  END IF;

  IF v_mode = 'number_only' AND (v_group IS NULL OR jsonb_array_length(v_group) = 0)
     AND jsonb_array_length(v_rows) = 1 THEN
    v_number := (v_rows->0->>v_first_alias)::numeric;
    RETURN jsonb_build_object(
      'status', 'success',
      'dataset', v_dataset,
      'response_mode', v_mode,
      'number', v_number,
      'result_count', 1,
      'returned_row_count', 1,
      'bound_value_count', jsonb_array_length(v_binds),
      'duration_ms', (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'dataset', v_dataset,
    'response_mode', v_mode,
    'result_count', jsonb_array_length(v_rows),
    'returned_row_count', jsonb_array_length(v_rows),
    'rows', v_rows,
    'bound_value_count', jsonb_array_length(v_binds),
    'duration_ms', (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION wam_ai._query_parse_mdy_date(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai._query_nairobi_relative_range(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai._query_resolve_field_expr(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai._query_field_kind(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai._query_apply_filters(text, jsonb, text, jsonb) FROM PUBLIC;
-- Note: helper signature is (text, jsonb, text, jsonb) RETURNS TABLE — not granted to login roles.
REVOKE ALL ON FUNCTION wam_ai._query_from_clause(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai._query_business_ref_expr(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai._query_pk_alias(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION wam_ai.describe_business_query_catalogue(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.list_business_records(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.aggregate_business_metrics(jsonb) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    GRANT EXECUTE ON FUNCTION wam_ai.describe_business_query_catalogue(text) TO wam_ai_business_readonly;
    GRANT EXECUTE ON FUNCTION wam_ai.list_business_records(jsonb) TO wam_ai_business_readonly;
    GRANT EXECUTE ON FUNCTION wam_ai.aggregate_business_metrics(jsonb) TO wam_ai_business_readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    REVOKE ALL ON FUNCTION wam_ai.describe_business_query_catalogue(text) FROM wam_ai_business_actions;
    REVOKE ALL ON FUNCTION wam_ai.list_business_records(jsonb) FROM wam_ai_business_actions;
    REVOKE ALL ON FUNCTION wam_ai.aggregate_business_metrics(jsonb) FROM wam_ai_business_actions;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION wam_ai.describe_business_query_catalogue(text) FROM anon;
    REVOKE ALL ON FUNCTION wam_ai.list_business_records(jsonb) FROM anon;
    REVOKE ALL ON FUNCTION wam_ai.aggregate_business_metrics(jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION wam_ai.describe_business_query_catalogue(text) FROM authenticated;
    REVOKE ALL ON FUNCTION wam_ai.list_business_records(jsonb) FROM authenticated;
    REVOKE ALL ON FUNCTION wam_ai.aggregate_business_metrics(jsonb) FROM authenticated;
  END IF;
END;
$grant$;
