-- Phase 1A.9 disposable seed rows (visit_date dual-format + Nairobi window proofs)
-- Safe on disposable DB only.
-- Includes MDY + ISO mixed rows and an ISO-only production-shaped cohort.

DO $seed$
DECLARE
  v_today_nairobi date := (timezone('Africa/Nairobi', now()))::date;
  v_mdy text :=
    (extract(month from v_today_nairobi)::int)::text || '/' ||
    (extract(day from v_today_nairobi)::int)::text || '/' ||
    (extract(year from v_today_nairobi)::int)::text;
  v_iso text := to_char(v_today_nairobi, 'YYYY-MM-DD');
  v_dow int := extract(isodow from v_today_nairobi)::int;
  v_week_mon date := v_today_nairobi - (v_dow - 1);
  v_last_week_mon date := v_week_mon - 7;
  v_last_week_iso text := to_char(v_last_week_mon + 2, 'YYYY-MM-DD'); -- Wednesday last week
  v_last_week_mdy text :=
    (extract(month from (v_last_week_mon + 3))::int)::text || '/' ||
    (extract(day from (v_last_week_mon + 3))::int)::text || '/' ||
    (extract(year from (v_last_week_mon + 3))::int)::text;
  v_cr_today_mdy uuid := 'aaaaaaaa-0009-4000-8000-000000000901';
  v_cr_bad_mdy uuid := 'aaaaaaaa-0009-4000-8000-000000000902';
  v_cr_old uuid := 'aaaaaaaa-0009-4000-8000-000000000903';
  v_cr_today_iso uuid := 'aaaaaaaa-0009-4000-8000-000000000904';
  v_cr_bad_iso uuid := 'aaaaaaaa-0009-4000-8000-000000000905';
  v_cr_iso_padded_mdy uuid := 'aaaaaaaa-0009-4000-8000-000000000906';
  v_cr_last_iso uuid := 'aaaaaaaa-0009-4000-8000-000000000907';
  v_cr_last_mdy uuid := 'aaaaaaaa-0009-4000-8000-000000000908';
  v_cr_inject uuid := 'aaaaaaaa-0009-4000-8000-000000000909';
  v_cr_iso_only_1 uuid := 'aaaaaaaa-0009-4000-8000-000000000910';
  v_cr_iso_only_2 uuid := 'aaaaaaaa-0009-4000-8000-000000000911';
  v_cr_iso_only_3 uuid := 'aaaaaaaa-0009-4000-8000-000000000912';
  v_cr_ws_iso uuid := 'aaaaaaaa-0009-4000-8000-000000000913';
  v_lead_today uuid := 'bbbbbbbb-0009-4000-8000-000000000901';
  v_agent uuid;
  v_padded_mdy text :=
    lpad((extract(month from v_today_nairobi)::int)::text, 2, '0') || '/' ||
    lpad((extract(day from v_today_nairobi)::int)::text, 2, '0') || '/' ||
    (extract(year from v_today_nairobi)::int)::text;
BEGIN
  SELECT id INTO v_agent FROM public.agents ORDER BY created_at NULLS LAST LIMIT 1;

  UPDATE public.agents
  SET created_at = (date_trunc('month', timezone('Africa/Nairobi', now())) AT TIME ZONE 'Africa/Nairobi')
                   + interval '2 days'
  WHERE id = v_agent;

  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_today_mdy, v_agent, '1A9 Visit Today MDY', '254700000901', 'pending', v_mdy,
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET
    visit_date = EXCLUDED.visit_date,
    created_at = EXCLUDED.created_at,
    status = EXCLUDED.status,
    customer_name = EXCLUDED.customer_name;

  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_today_iso, v_agent, '1A9 Visit Today ISO', '254700000904', 'pending', v_iso,
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET
    visit_date = EXCLUDED.visit_date,
    created_at = EXCLUDED.created_at,
    customer_name = EXCLUDED.customer_name;

  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_iso_padded_mdy, v_agent, '1A9 Visit Today ZeroPad MDY', '254700000906', 'pending', v_padded_mdy,
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET
    visit_date = EXCLUDED.visit_date,
    customer_name = EXCLUDED.customer_name;

  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_bad_mdy, v_agent, '1A9 Bad MDY', '254700000902', 'pending', '13/40/2026',
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET visit_date = EXCLUDED.visit_date, customer_name = EXCLUDED.customer_name;

  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_bad_iso, v_agent, '1A9 Bad ISO', '254700000905', 'pending', '2026-02-30',
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET visit_date = EXCLUDED.visit_date, customer_name = EXCLUDED.customer_name;

  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_old, v_agent, '1A9 Old Visit', '254700000903', 'pending', '1/1/2020',
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET visit_date = EXCLUDED.visit_date;

  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_last_iso, v_agent, '1A9 Last Week ISO', '254700000907', 'pending', v_last_week_iso,
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET visit_date = EXCLUDED.visit_date, customer_name = EXCLUDED.customer_name;

  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_last_mdy, v_agent, '1A9 Last Week MDY', '254700000908', 'pending', v_last_week_mdy,
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET visit_date = EXCLUDED.visit_date, customer_name = EXCLUDED.customer_name;

  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_inject, v_agent, '1A9 Inject Date', '254700000909', 'pending',
    v_iso || $$'; DROP TABLE agents;--$$,
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET visit_date = EXCLUDED.visit_date, customer_name = EXCLUDED.customer_name;

  -- Production-shaped ISO-only cohort (all ISO YYYY-MM-DD for today)
  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES
    (v_cr_iso_only_1, v_agent, '1A9 ISO-Only Prod 1', '254700000910', 'pending', v_iso, now() - interval '11 days', 'Nairobi'),
    (v_cr_iso_only_2, v_agent, '1A9 ISO-Only Prod 2', '254700000911', 'pending', v_iso, now() - interval '12 days', 'Nairobi'),
    (v_cr_iso_only_3, v_agent, '1A9 ISO-Only Prod 3', '254700000912', 'pending', v_iso, now() - interval '13 days', 'Nairobi')
  ON CONFLICT (id) DO UPDATE SET
    visit_date = EXCLUDED.visit_date,
    created_at = EXCLUDED.created_at,
    customer_name = EXCLUDED.customer_name;

  -- Whitespace-trimmed ISO (stored with surrounding spaces; parser must accept after btrim)
  INSERT INTO public.customer_registrations (
    id, agent_id, customer_name, airtel_number, status, visit_date, created_at, installation_town
  ) VALUES (
    v_cr_ws_iso, v_agent, '1A9 Visit WS ISO', '254700000913', 'pending', '  ' || v_iso || '  ',
    now() - interval '10 days', 'Nairobi'
  )
  ON CONFLICT (id) DO UPDATE SET visit_date = EXCLUDED.visit_date, customer_name = EXCLUDED.customer_name;

  INSERT INTO public.inbound_leads (
    id, customer_name, primary_phone, status, county, visit_date, created_at
  ) VALUES (
    v_lead_today, '1A9 Lead Visit Today', '254700000911', 'assigned', 'Nairobi',
    v_today_nairobi, now() - interval '3 days'
  )
  ON CONFLICT (id) DO UPDATE SET
    visit_date = EXCLUDED.visit_date,
    created_at = EXCLUDED.created_at,
    status = EXCLUDED.status;

  RAISE NOTICE 'phase1a9_fixture_seed_pass mdy=% iso=%', v_mdy, v_iso;
END;
$seed$;
