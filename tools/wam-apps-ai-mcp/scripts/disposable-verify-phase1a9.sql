-- Phase 1A.9 disposable verify (expanded proofs)
-- Run after 20260910120000 + disposable-fixture-phase1a9.sql + role grants.

DO $v$
DECLARE
  v_mdy date;
  v_bad date;
  v_rel record;
  v_agg jsonb;
  v_list jsonb;
  v_n numeric;
  v_today date := (timezone('Africa/Nairobi', now()))::date;
  v_sql_probe text;
  v_row jsonb;
  v_found boolean;
  v_expr text;
  v_plan_sql text;
  v_plan_binds jsonb;
  v_hostile text;
  v_hostiles text[] := ARRAY[
    $$pending'; DROP TABLE agents;--$$,
    $$x$tag$ SELECT 1; --$$,
    $$"; SELECT 1; --$$,
    $$1::int; SELECT 1$$,
    U&'unicode\2215slash',
    $${"a":1}$$
  ];
BEGIN
  -- Fail-closed dual-format parse (MDY + ISO)
  v_mdy := wam_ai._query_parse_mdy_date('9/10/2026');
  IF v_mdy IS DISTINCT FROM DATE '2026-09-10' THEN
    RAISE EXCEPTION 'phase1a9_fail: valid MDY parse';
  END IF;
  v_mdy := wam_ai._query_parse_mdy_date('09/10/2026');
  IF v_mdy IS DISTINCT FROM DATE '2026-09-10' THEN
    RAISE EXCEPTION 'phase1a9_fail: zero-padded MDY parse';
  END IF;
  v_mdy := wam_ai._query_parse_mdy_date('2026-09-10');
  IF v_mdy IS DISTINCT FROM DATE '2026-09-10' THEN
    RAISE EXCEPTION 'phase1a9_fail: valid ISO parse';
  END IF;
  v_mdy := wam_ai._query_parse_mdy_date('  9/10/2026  ');
  IF v_mdy IS DISTINCT FROM DATE '2026-09-10' THEN
    RAISE EXCEPTION 'phase1a9_fail: trimmed MDY whitespace policy';
  END IF;
  v_mdy := wam_ai._query_parse_mdy_date('  2026-09-10  ');
  IF v_mdy IS DISTINCT FROM DATE '2026-09-10' THEN
    RAISE EXCEPTION 'phase1a9_fail: trimmed ISO whitespace policy';
  END IF;
  v_bad := wam_ai._query_parse_mdy_date('13/40/2026');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_fail: invalid MDY must be null';
  END IF;
  v_bad := wam_ai._query_parse_mdy_date('2/30/2026');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_fail: impossible MDY must be null';
  END IF;
  v_bad := wam_ai._query_parse_mdy_date('2026-02-30');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_fail: impossible ISO must be null';
  END IF;
  v_bad := wam_ai._query_parse_mdy_date('2026-9-10');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_fail: unpadded ISO must be null';
  END IF;
  v_bad := wam_ai._query_parse_mdy_date('2026/09/10');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_fail: slash-ISO hybrid must be null';
  END IF;
  v_bad := wam_ai._query_parse_mdy_date('not-a-date');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_fail: garbage date must be null';
  END IF;
  IF wam_ai._query_parse_mdy_date('02/29/2024') IS DISTINCT FROM DATE '2024-02-29'
     OR wam_ai._query_parse_mdy_date('2024-02-29') IS DISTINCT FROM DATE '2024-02-29' THEN
    RAISE EXCEPTION 'phase1a9_fail: leap day must parse';
  END IF;
  IF wam_ai._query_parse_mdy_date('02/29/2025') IS NOT NULL
     OR wam_ai._query_parse_mdy_date('2025-02-29') IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_fail: non-leap Feb 29 must be null';
  END IF;
  -- SQL-injection-shaped stored values must not parse
  IF wam_ai._query_parse_mdy_date($$2026-09-10'; DROP TABLE agents;--$$) IS NOT NULL THEN
    RAISE EXCEPTION 'phase1a9_fail: injection-shaped date must be null';
  END IF;

  SELECT * INTO v_rel FROM wam_ai._query_nairobi_relative_range('this_month');
  IF v_rel.start_date IS NULL OR v_rel.end_date <= v_rel.start_date THEN
    RAISE EXCEPTION 'phase1a9_fail: this_month range';
  END IF;
  IF v_rel.start_ts >= v_rel.end_ts THEN
    RAISE EXCEPTION 'phase1a9_fail: this_month half-open timestamptz';
  END IF;
  IF v_rel.start_date IS DISTINCT FROM date_trunc('month', v_today)::date THEN
    RAISE EXCEPTION 'phase1a9_fail: Nairobi month start mismatch';
  END IF;

  -- Reject arbitrary SQL keys
  v_agg := wam_ai.aggregate_business_metrics(jsonb_build_object(
    'dataset', 'agents',
    'sql', 'select 1',
    'metrics', jsonb_build_array(jsonb_build_object('fn', 'count', 'field', 'id'))
  ));
  IF v_agg->>'status' IS DISTINCT FROM 'error' OR v_agg->>'error_category' IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'phase1a9_fail: sql key must be denied';
  END IF;

  -- Reject unknown dataset
  v_agg := wam_ai.aggregate_business_metrics(jsonb_build_object(
    'dataset', 'payments',
    'metrics', jsonb_build_array(jsonb_build_object('fn', 'count', 'field', 'id'))
  ));
  IF v_agg->>'error_category' IS DISTINCT FROM 'invalid_dataset' THEN
    RAISE EXCEPTION 'phase1a9_fail: invalid dataset';
  END IF;

  -- Agents joined this month (number_only) — created_at + Nairobi
  v_agg := wam_ai.aggregate_business_metrics(jsonb_build_object(
    'dataset', 'agents',
    'metrics', jsonb_build_array(jsonb_build_object('fn', 'count', 'field', 'id', 'alias', 'agents_joined')),
    'filters', jsonb_build_array(jsonb_build_object(
      'field', 'created_at', 'op', 'relative_range', 'value', 'this_month'
    )),
    'response_mode', 'number_only'
  ));
  IF v_agg->>'status' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'phase1a9_fail: agents this_month aggregate: %', v_agg;
  END IF;
  IF v_agg->>'dataset' IS DISTINCT FROM 'agents' THEN
    RAISE EXCEPTION 'phase1a9_fail: dataset echo';
  END IF;
  IF v_agg->>'response_mode' IS DISTINCT FROM 'number_only' THEN
    RAISE EXCEPTION 'phase1a9_fail: number_only mode';
  END IF;
  v_n := (v_agg->>'number')::numeric;
  IF v_n IS NULL OR v_n < 1 THEN
    RAISE EXCEPTION 'phase1a9_fail: expected >=1 agent joined this month, got %', v_n;
  END IF;
  IF coalesce((v_agg->>'bound_value_count')::int, 0) < 2 THEN
    RAISE EXCEPTION 'phase1a9_fail: expected bound relative-range values';
  END IF;

  -- Prove filter expression uses created_at (not visit_date) for agents joined
  v_expr := wam_ai._query_resolve_field_expr('agents', 'created_at', true);
  IF v_expr IS DISTINCT FROM 'a.created_at' THEN
    RAISE EXCEPTION 'phase1a9_fail: agents joined field must be a.created_at';
  END IF;

  -- visit_day → visit_date on customer_registrations (created_at not substituted)
  v_expr := wam_ai._query_resolve_field_expr('customer_registrations', 'visit_date', true);
  IF v_expr IS DISTINCT FROM 'wam_ai._query_parse_mdy_date(cr.visit_date)' THEN
    RAISE EXCEPTION 'phase1a9_fail: CR visit_date expr';
  END IF;

  v_list := wam_ai.list_business_records(jsonb_build_object(
    'dataset', 'customer_registrations',
    'filters', jsonb_build_array(jsonb_build_object(
      'field', 'visit_date', 'op', 'relative_range', 'value', 'today'
    )),
    'select', jsonb_build_array('visit_date', 'status', 'customer_name', 'created_at'),
    'limit', 50,
    'response_mode', 'detailed'
  ));
  IF v_list->>'status' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'phase1a9_fail: visit_date list: %', v_list;
  END IF;
  IF (v_list->>'total_count')::int < 1 THEN
    RAISE EXCEPTION 'phase1a9_fail: expected CR visit today row';
  END IF;

  -- Seeded today row present; bad MDY/ISO must not appear; created_at stays historical
  v_found := false;
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_list->'rows')
  LOOP
    IF v_row->>'customer_name' IN ('1A9 Bad MDY', '1A9 Bad ISO', '1A9 Inject Date') THEN
      RAISE EXCEPTION 'phase1a9_fail: malformed visit_date matched visit today';
    END IF;
    IF v_row->>'customer_name' IN ('1A9 Visit Today MDY', '1A9 Visit Today ISO', '1A9 Visit Today ZeroPad MDY', '1A9 Visit WS ISO') THEN
      v_found := true;
      IF (v_row->>'created_at')::timestamptz::date >= v_today THEN
        RAISE EXCEPTION 'phase1a9_fail: visit filter appears to use created_at';
      END IF;
    END IF;
  END LOOP;
  IF NOT v_found THEN
    RAISE EXCEPTION 'phase1a9_fail: missing seeded CR visit today (MDY/ISO)';
  END IF;

  -- Mixed-format: today list must include both MDY and ISO named rows
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_list->'rows') r
    WHERE r->>'customer_name' = '1A9 Visit Today MDY'
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_list->'rows') r
    WHERE r->>'customer_name' = '1A9 Visit Today ISO'
  ) THEN
    RAISE EXCEPTION 'phase1a9_fail: mixed MDY+ISO today rows required';
  END IF;

  -- Malformed MDY alone: eq_calendar_date must return 0 without crash
  v_list := wam_ai.list_business_records(jsonb_build_object(
    'dataset', 'customer_registrations',
    'filters', jsonb_build_array(
      jsonb_build_object('field', 'customer_name', 'op', 'eq', 'value', '1A9 Bad MDY'),
      jsonb_build_object('field', 'visit_date', 'op', 'eq_calendar_date', 'value', v_today::text)
    ),
    'limit', 10
  ));
  IF v_list->>'status' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'phase1a9_fail: bad MDY query crashed: %', v_list;
  END IF;
  IF (v_list->>'total_count')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'phase1a9_fail: bad MDY should not match calendar date';
  END IF;

  -- inbound_leads visit_date uses DATE column
  v_expr := wam_ai._query_resolve_field_expr('inbound_leads', 'visit_date', true);
  IF v_expr IS DISTINCT FROM 'l.visit_date' THEN
    RAISE EXCEPTION 'phase1a9_fail: lead visit_date must be l.visit_date';
  END IF;
  v_list := wam_ai.list_business_records(jsonb_build_object(
    'dataset', 'inbound_leads',
    'filters', jsonb_build_array(jsonb_build_object(
      'field', 'visit_date', 'op', 'relative_range', 'value', 'today'
    )),
    'select', jsonb_build_array('visit_date', 'customer_name', 'status'),
    'limit', 20
  ));
  IF v_list->>'status' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'phase1a9_fail: lead visit today: %', v_list;
  END IF;
  IF (v_list->>'total_count')::int < 1 THEN
    RAISE EXCEPTION 'phase1a9_fail: expected inbound lead visit today';
  END IF;

  -- Injection-style field rejected
  v_list := wam_ai.list_business_records(jsonb_build_object(
    'dataset', 'agents',
    'filters', jsonb_build_array(jsonb_build_object(
      'field', 'created_at;drop table agents', 'op', 'eq', 'value', 'x'
    )),
    'limit', 1
  ));
  IF v_list->>'status' IS DISTINCT FROM 'error' THEN
    RAISE EXCEPTION 'phase1a9_fail: injection field must error';
  END IF;

  -- Sort injection
  v_list := wam_ai.list_business_records(jsonb_build_object(
    'dataset', 'agents',
    'sort', jsonb_build_array(jsonb_build_object('field', 'created_at;select 1', 'dir', 'asc')),
    'limit', 1
  ));
  IF v_list->>'status' IS DISTINCT FROM 'error' THEN
    RAISE EXCEPTION 'phase1a9_fail: sort injection must error';
  END IF;

  -- Group injection
  v_agg := wam_ai.aggregate_business_metrics(jsonb_build_object(
    'dataset', 'agents',
    'metrics', jsonb_build_array(jsonb_build_object('fn', 'count', 'field', 'id')),
    'group_by', jsonb_build_array('status); drop table agents; --')
  ));
  IF v_agg->>'status' IS DISTINCT FROM 'error' THEN
    RAISE EXCEPTION 'phase1a9_fail: group injection must error';
  END IF;

  -- Operator injection / unknown op
  v_list := wam_ai.list_business_records(jsonb_build_object(
    'dataset', 'agents',
    'filters', jsonb_build_array(jsonb_build_object(
      'field', 'status', 'op', 'eq;select 1', 'value', 'pending'
    )),
    'limit', 1
  ));
  IF v_list->>'status' IS DISTINCT FROM 'error' THEN
    RAISE EXCEPTION 'phase1a9_fail: bad operator must error';
  END IF;

  -- Value injection cannot break out: bound via $1, not SQL text
  v_list := wam_ai.list_business_records(jsonb_build_object(
    'dataset', 'agents',
    'filters', jsonb_build_array(jsonb_build_object(
      'field', 'status', 'op', 'eq', 'value', 'pending''; drop table agents; --'
    )),
    'limit', 5
  ));
  IF v_list->>'status' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'phase1a9_fail: quoted value should not crash: %', v_list;
  END IF;
  IF to_regclass('public.agents') IS NULL THEN
    RAISE EXCEPTION 'phase1a9_fail: agents table dropped by injection';
  END IF;

  -- Prove hostile payloads stay in bind array, never in SQL text
  FOREACH v_hostile IN ARRAY v_hostiles
  LOOP
    SELECT f.out_sql, f.out_binds INTO v_plan_sql, v_plan_binds
    FROM wam_ai._query_apply_filters(
      'agents',
      jsonb_build_array(jsonb_build_object('field', 'status', 'op', 'eq', 'value', v_hostile)),
      ' WHERE TRUE',
      '[]'::jsonb
    ) AS f;
    IF position(v_hostile IN v_plan_sql) > 0 THEN
      RAISE EXCEPTION 'phase1a9_fail: hostile value leaked into SQL text: %', v_hostile;
    END IF;
    IF v_plan_sql !~ '\$1->>' THEN
      RAISE EXCEPTION 'phase1a9_fail: expected $1->> bind reference';
    END IF;
    IF v_plan_binds->>0 IS DISTINCT FROM v_hostile THEN
      RAISE EXCEPTION 'phase1a9_fail: bind array missing hostile payload';
    END IF;
  END LOOP;

  -- Function body must not use format(%L)
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai' AND p.proname = '_query_apply_filters'
      AND pg_get_functiondef(p.oid) LIKE '%\%L%'
  ) THEN
    RAISE EXCEPTION 'phase1a9_fail: _query_apply_filters still contains %%L';
  END IF;

  -- Join rejected
  v_list := wam_ai.list_business_records(jsonb_build_object(
    'dataset', 'agents',
    'joins', jsonb_build_array('agents->leads'),
    'limit', 1
  ));
  IF v_list->>'error_category' IS DISTINCT FROM 'invalid_join' THEN
    RAISE EXCEPTION 'phase1a9_fail: joins must reject';
  END IF;

  -- Pagination bounds
  v_list := wam_ai.list_business_records(jsonb_build_object(
    'dataset', 'agents',
    'limit', 100,
    'offset', 0,
    'sort', jsonb_build_array(jsonb_build_object('field', 'created_at', 'dir', 'desc'))
  ));
  IF v_list->>'status' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'phase1a9_fail: pagination list';
  END IF;
  IF (v_list->>'returned_row_count')::int > 100 THEN
    RAISE EXCEPTION 'phase1a9_fail: max limit breached';
  END IF;
  IF (v_list->>'total_count')::int < (v_list->>'returned_row_count')::int THEN
    RAISE EXCEPTION 'phase1a9_fail: total_count vs returned';
  END IF;

  -- Relative ranges: yesterday / this_week / last_week / this_month / last_month
  FOREACH v_hostile IN ARRAY ARRAY['yesterday','this_week','last_week','this_month','last_month']
  LOOP
    SELECT * INTO v_rel FROM wam_ai._query_nairobi_relative_range(v_hostile);
    IF v_rel.start_date IS NULL OR v_rel.end_date <= v_rel.start_date OR v_rel.start_ts >= v_rel.end_ts THEN
      RAISE EXCEPTION 'phase1a9_fail: relative range %', v_hostile;
    END IF;
  END LOOP;

  -- next_week not supported (deferred): must error
  BEGIN
    PERFORM * FROM wam_ai._query_nairobi_relative_range('next_week');
    RAISE EXCEPTION 'phase1a9_fail: next_week should be unsupported';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT ILIKE '%invalid_relative_period%' THEN
        RAISE;
      END IF;
  END;

  -- last_week includes mixed-format last-week seeds
  v_agg := wam_ai.aggregate_business_metrics(jsonb_build_object(
    'dataset', 'customer_registrations',
    'metrics', jsonb_build_array(jsonb_build_object('fn', 'count', 'field', 'id', 'alias', 'n')),
    'filters', jsonb_build_array(jsonb_build_object(
      'field', 'visit_date', 'op', 'relative_range', 'value', 'last_week'
    )),
    'response_mode', 'number_only'
  ));
  IF v_agg->>'status' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'phase1a9_fail: last_week aggregate: %', v_agg;
  END IF;
  IF (v_agg->>'number')::numeric < 2 THEN
    RAISE EXCEPTION 'phase1a9_fail: expected >=2 last_week MDY+ISO rows, got %', v_agg->>'number';
  END IF;

  -- Production-shaped ISO-only cohort: all three ISO-Only Prod rows match today
  v_agg := wam_ai.aggregate_business_metrics(jsonb_build_object(
    'dataset', 'customer_registrations',
    'metrics', jsonb_build_array(jsonb_build_object('fn', 'count', 'field', 'id', 'alias', 'n')),
    'filters', jsonb_build_array(
      jsonb_build_object('field', 'visit_date', 'op', 'relative_range', 'value', 'today'),
      jsonb_build_object('field', 'customer_name', 'op', 'ilike_prefix', 'value', '1A9 ISO-Only Prod')
    ),
    'response_mode', 'number_only'
  ));
  IF v_agg->>'status' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'phase1a9_fail: ISO-only prod shaped: %', v_agg;
  END IF;
  IF (v_agg->>'number')::numeric IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'phase1a9_fail: ISO-only prod shaped expected 3, got %', v_agg->>'number';
  END IF;

  -- this_week must be non-zero with mixed formats (production false-zero regression)
  v_agg := wam_ai.aggregate_business_metrics(jsonb_build_object(
    'dataset', 'customer_registrations',
    'metrics', jsonb_build_array(jsonb_build_object('fn', 'count', 'field', 'id', 'alias', 'n')),
    'filters', jsonb_build_array(jsonb_build_object(
      'field', 'visit_date', 'op', 'relative_range', 'value', 'this_week'
    )),
    'response_mode', 'number_only'
  ));
  IF v_agg->>'status' IS DISTINCT FROM 'success' OR (v_agg->>'number')::numeric < 3 THEN
    RAISE EXCEPTION 'phase1a9_fail: this_week false-zero regression: %', v_agg;
  END IF;

  -- Catalogue version after dual-format remediation
  v_list := wam_ai.describe_business_query_catalogue('customer_registrations');
  IF v_list->>'catalogue_version' IS DISTINCT FROM '1a9.2' THEN
    RAISE EXCEPTION 'phase1a9_fail: catalogue_version expected 1a9.2';
  END IF;

  RAISE NOTICE 'phase1a9_disposable_verify_pass';
END;
$v$;
