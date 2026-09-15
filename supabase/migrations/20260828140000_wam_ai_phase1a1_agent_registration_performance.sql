-- =============================================================================
-- WAM APPS AI Phase 1A.1 — agent registration performance aggregate
-- Additive only. Attributes customer_registrations / safaricom_registrations
-- by agent_id and created_at. Does NOT equate lead offers with registrations.
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai.validate_required_range(
  p_from timestamptz,
  p_to timestamptz
) RETURNS TABLE(range_from timestamptz, range_to timestamptz)
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  v_max integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = '22023';
  END IF;
  v_max := LEAST((SELECT max_range_days FROM wam_ai.reporting_config WHERE id = 1), 90);
  IF p_to - p_from > make_interval(days => v_max) THEN
    RAISE EXCEPTION 'range_too_large' USING ERRCODE = '22023';
  END IF;
  -- Apply caller-supplied UTC instants exactly (Kenya-day boundaries passed as UTC).
  range_from := p_from;
  range_to := p_to;
  RETURN NEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.estimated_airtel_reg_commission_ksh(
  p_preferred_package text,
  p_commission_package text,
  p_commission_units integer,
  p_units_required integer,
  p_standard_rate numeric,
  p_premium_rate numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT
    CASE
      WHEN COALESCE(p_commission_package, p_preferred_package, 'standard') = 'premium'
        THEN COALESCE(p_premium_rate, 700)
      ELSE COALESCE(p_standard_rate, 500)
    END * GREATEST(1, COALESCE(p_commission_units, p_units_required, 1));
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_agent_registration_performance(
  p_from timestamptz,
  p_to timestamptz,
  p_product text DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_limit integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  r record;
  v_product text := NULLIF(lower(btrim(p_product)), '');
  v_limit integer := wam_ai.clamp_search_limit(p_limit);
  v_standard numeric := 500;
  v_premium numeric := 700;
  v_total_regs integer := 0;
  v_unattributed integer := 0;
  v_unknown_class integer := 0;
  v_warnings jsonb := '[]'::jsonb;
  v jsonb;
BEGIN
  IF v_product IS NOT NULL AND v_product NOT IN ('airtel', 'safaricom') THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM wam_ai.validate_required_range(p_from, p_to);

  SELECT standard_commission, premium_commission
  INTO v_standard, v_premium
  FROM public.commission_rates_config
  LIMIT 1;

  IF NOT FOUND THEN
    v_warnings := v_warnings || jsonb_build_array(
      'commission_rates_config_missing_using_defaults_500_700'
    );
  END IF;

  IF to_regclass('public.commission_rates_config') IS NULL THEN
    v_warnings := v_warnings || jsonb_build_array(
      'commission_rates_config_table_unavailable'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_registrations cr
    WHERE cr.created_at >= r.range_from AND cr.created_at <= r.range_to
      AND cr.inbound_lead_id IS NULL AND COALESCE(cr.commission_exempt, false) = true
  ) THEN
    v_unknown_class := v_unknown_class + (
      SELECT count(*)::int FROM public.customer_registrations cr
      WHERE cr.created_at >= r.range_from AND cr.created_at <= r.range_to
        AND cr.inbound_lead_id IS NULL AND COALESCE(cr.commission_exempt, false) = true
    );
    v_warnings := v_warnings || jsonb_build_array(
      'inconsistent_airtel_rows_commission_exempt_without_inbound_lead_id'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_registrations cr
    WHERE cr.created_at >= r.range_from AND cr.created_at <= r.range_to
      AND cr.inbound_lead_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.inbound_leads l WHERE l.id = cr.inbound_lead_id)
  ) THEN
    v_unknown_class := v_unknown_class + (
      SELECT count(*)::int FROM public.customer_registrations cr
      WHERE cr.created_at >= r.range_from AND cr.created_at <= r.range_to
        AND cr.inbound_lead_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.inbound_leads l WHERE l.id = cr.inbound_lead_id)
    );
    v_warnings := v_warnings || jsonb_build_array(
      'airtel_registrations_reference_missing_inbound_lead'
    );
  END IF;

  v_warnings := v_warnings || jsonb_build_array(
    'safaricom_registration_commission_not_estimated_in_sql'
  );

  SELECT
    COALESCE((
      SELECT count(*)::int FROM (
        SELECT cr.id FROM public.customer_registrations cr
        WHERE cr.created_at >= r.range_from AND cr.created_at <= r.range_to
          AND (v_product IS NULL OR v_product = 'airtel')
        UNION ALL
        SELECT sr.id FROM public.safaricom_registrations sr
        WHERE sr.created_at >= r.range_from AND sr.created_at <= r.range_to
          AND (v_product IS NULL OR v_product = 'safaricom')
      ) t
    ), 0),
    COALESCE((
      SELECT count(*)::int FROM (
        SELECT cr.id FROM public.customer_registrations cr
        WHERE cr.created_at >= r.range_from AND cr.created_at <= r.range_to
          AND (cr.agent_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.agents a WHERE a.id = cr.agent_id))
          AND (v_product IS NULL OR v_product = 'airtel')
        UNION ALL
        SELECT sr.id FROM public.safaricom_registrations sr
        WHERE sr.created_at >= r.range_from AND sr.created_at <= r.range_to
          AND (sr.agent_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.agents a WHERE a.id = sr.agent_id))
          AND (v_product IS NULL OR v_product = 'safaricom')
      ) u
    ), 0)
  INTO v_total_regs, v_unattributed;

  SELECT jsonb_build_object(
    'operation', 'get_agent_registration_performance',
    'range_from', r.range_from,
    'range_to', r.range_to,
    'timezone_label', 'Africa/Nairobi',
    'product_filter', v_product,
    'limit', v_limit,
    'total_registration_count', v_total_regs,
    'unattributed_registration_count', v_unattributed,
    'unknown_source_classification_count', v_unknown_class,
    'warnings', v_warnings,
    'metric_definitions', jsonb_build_object(
      'range_bounds', 'created_at >= range_from AND created_at <= range_to using caller-supplied UTC instants exactly',
      'timezone_label', 'Business reporting timezone; range instants are not re-bucketed server-side',
      'total_customer_registrations', 'Airtel customer_registrations + Safaricom safaricom_registrations created in range',
      'self_generated_registrations', 'Airtel with inbound_lead_id IS NULL plus all Safaricom registrations (Safaricom has no lead link column)',
      'dispatched_lead_registrations', 'Airtel customer_registrations with inbound_lead_id IS NOT NULL (company-dispatched MS Forms completion)',
      'confirmed_installations', 'Registrations created in range with status installed',
      'pending_or_incomplete_registrations', 'Registrations created in range with status pending (not installed/rejected/duplicate/cancelled)',
      'conversion_rate', 'confirmed_installations / total_customer_registrations; null when denominator is zero',
      'commission_earned_ksh', 'Estimated Airtel self-generated registration commission for installed non-exempt rows only; Safaricom not included',
      'dispatched_offers_accepted_in_range', 'lead_offers accepted in range — separate from registration creation counts'
    ),
    'agents', COALESCE((
      SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.total_customer_registrations DESC, row_data.agent_name)
      FROM (
        SELECT
          a.id AS agent_id,
          wam_ai.agent_business_id(a.id) AS agent_business_id,
          COALESCE(NULLIF(btrim(a.name), ''), 'Unnamed agent') AS agent_name,
          (
            SELECT count(*)::int FROM public.customer_registrations cr
            WHERE cr.agent_id = a.id
              AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
              AND (v_product IS NULL OR v_product = 'airtel')
          ) + (
            SELECT count(*)::int FROM public.safaricom_registrations sr
            WHERE sr.agent_id = a.id
              AND sr.created_at >= r.range_from AND sr.created_at <= r.range_to
              AND (v_product IS NULL OR v_product = 'safaricom')
          ) AS total_customer_registrations,
          (
            SELECT count(*)::int FROM public.customer_registrations cr
            WHERE cr.agent_id = a.id
              AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
              AND cr.inbound_lead_id IS NULL
              AND (v_product IS NULL OR v_product = 'airtel')
          ) + (
            SELECT count(*)::int FROM public.safaricom_registrations sr
            WHERE sr.agent_id = a.id
              AND sr.created_at >= r.range_from AND sr.created_at <= r.range_to
              AND (v_product IS NULL OR v_product = 'safaricom')
          ) AS self_generated_registrations,
          (
            SELECT count(*)::int FROM public.customer_registrations cr
            WHERE cr.agent_id = a.id
              AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
              AND cr.inbound_lead_id IS NOT NULL
              AND (v_product IS NULL OR v_product = 'airtel')
          ) AS dispatched_lead_registrations,
          (
            SELECT count(*)::int FROM public.customer_registrations cr
            WHERE cr.agent_id = a.id
              AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
              AND (v_product IS NULL OR v_product = 'airtel')
          ) AS airtel_registrations,
          (
            SELECT count(*)::int FROM public.safaricom_registrations sr
            WHERE sr.agent_id = a.id
              AND sr.created_at >= r.range_from AND sr.created_at <= r.range_to
              AND (v_product IS NULL OR v_product = 'safaricom')
          ) AS safaricom_registrations,
          (
            SELECT count(*)::int FROM (
              SELECT cr.id FROM public.customer_registrations cr
              WHERE cr.agent_id = a.id
                AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
                AND cr.status = 'installed'
                AND (v_product IS NULL OR v_product = 'airtel')
              UNION ALL
              SELECT sr.id FROM public.safaricom_registrations sr
              WHERE sr.agent_id = a.id
                AND sr.created_at >= r.range_from AND sr.created_at <= r.range_to
                AND sr.status = 'installed'
                AND (v_product IS NULL OR v_product = 'safaricom')
            ) inst
          ) AS confirmed_installations,
          (
            SELECT count(*)::int FROM (
              SELECT cr.id FROM public.customer_registrations cr
              WHERE cr.agent_id = a.id
                AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
                AND cr.status = 'pending'
                AND (v_product IS NULL OR v_product = 'airtel')
              UNION ALL
              SELECT sr.id FROM public.safaricom_registrations sr
              WHERE sr.agent_id = a.id
                AND sr.created_at >= r.range_from AND sr.created_at <= r.range_to
                AND sr.status = 'pending'
                AND (v_product IS NULL OR v_product = 'safaricom')
            ) pend
          ) AS pending_or_incomplete_registrations,
          CASE
            WHEN (
              (SELECT count(*) FROM public.customer_registrations cr
                WHERE cr.agent_id = a.id AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
                  AND (v_product IS NULL OR v_product = 'airtel'))
              + (SELECT count(*) FROM public.safaricom_registrations sr
                WHERE sr.agent_id = a.id AND sr.created_at >= r.range_from AND sr.created_at <= r.range_to
                  AND (v_product IS NULL OR v_product = 'safaricom'))
            ) = 0 THEN NULL
            ELSE round(
              (
                (SELECT count(*)::numeric FROM (
                  SELECT cr.id FROM public.customer_registrations cr
                  WHERE cr.agent_id = a.id AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
                    AND cr.status = 'installed' AND (v_product IS NULL OR v_product = 'airtel')
                  UNION ALL
                  SELECT sr.id FROM public.safaricom_registrations sr
                  WHERE sr.agent_id = a.id AND sr.created_at >= r.range_from AND sr.created_at <= r.range_to
                    AND sr.status = 'installed' AND (v_product IS NULL OR v_product = 'safaricom')
                ) i)::numeric
                / NULLIF(
                  (SELECT count(*)::numeric FROM (
                    SELECT cr.id FROM public.customer_registrations cr
                    WHERE cr.agent_id = a.id AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
                      AND (v_product IS NULL OR v_product = 'airtel')
                    UNION ALL
                    SELECT sr.id FROM public.safaricom_registrations sr
                    WHERE sr.agent_id = a.id AND sr.created_at >= r.range_from AND sr.created_at <= r.range_to
                      AND (v_product IS NULL OR v_product = 'safaricom')
                  ) d)::numeric,
                  0
                )
              ) * 100.0,
              2
            )
          END AS conversion_rate,
          (
            SELECT COALESCE(sum(
              wam_ai.estimated_airtel_reg_commission_ksh(
                cr.preferred_package,
                cr.commission_package,
                cr.commission_units,
                cr.units_required,
                v_standard,
                v_premium
              )
            ), 0)::numeric
            FROM public.customer_registrations cr
            WHERE cr.agent_id = a.id
              AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
              AND cr.status = 'installed'
              AND NOT COALESCE(cr.commission_exempt, false)
              AND (v_product IS NULL OR v_product = 'airtel')
          ) AS commission_earned_ksh,
          (
            SELECT count(*)::int FROM public.lead_offers o
            WHERE o.agent_id = a.id
              AND o.status = 'accepted'
              AND o.responded_at >= r.range_from
              AND o.responded_at <= r.range_to
          ) AS dispatched_offers_accepted_in_range
        FROM public.agents a
        WHERE (p_agent_id IS NULL OR a.id = p_agent_id)
          AND EXISTS (
            SELECT 1 FROM public.customer_registrations cr
            WHERE cr.agent_id = a.id
              AND cr.created_at >= r.range_from AND cr.created_at <= r.range_to
              AND (v_product IS NULL OR v_product = 'airtel')
            UNION ALL
            SELECT 1 FROM public.safaricom_registrations sr
            WHERE sr.agent_id = a.id
              AND sr.created_at >= r.range_from AND sr.created_at <= r.range_to
              AND (v_product IS NULL OR v_product = 'safaricom')
          )
        ORDER BY total_customer_registrations DESC, agent_name
        LIMIT v_limit
      ) row_data
    ), '[]'::jsonb),
    'result_count', LEAST(v_limit, GREATEST((
      SELECT count(DISTINCT agent_id)::int FROM (
        SELECT cr.agent_id FROM public.customer_registrations cr
        WHERE cr.created_at >= r.range_from AND cr.created_at <= r.range_to
          AND cr.agent_id IS NOT NULL
          AND (v_product IS NULL OR v_product = 'airtel')
        UNION
        SELECT sr.agent_id FROM public.safaricom_registrations sr
        WHERE sr.created_at >= r.range_from AND sr.created_at <= r.range_to
          AND sr.agent_id IS NOT NULL
          AND (v_product IS NULL OR v_product = 'safaricom')
      ) agents_in_range
      WHERE (p_agent_id IS NULL OR agent_id = p_agent_id)
    ), 0))
  ) INTO v;

  RETURN v;
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.validate_required_range(timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.estimated_airtel_reg_commission_ksh(text,text,integer,integer,numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.get_agent_registration_performance(timestamptz,timestamptz,text,uuid,integer) FROM PUBLIC;

COMMENT ON FUNCTION wam_ai.get_agent_registration_performance IS
  'MCP: wam.business.analytics.get_agent_registration_performance';

-- GRANT EXECUTE ON FUNCTION wam_ai.get_agent_registration_performance(timestamptz,timestamptz,text,uuid,integer) TO wam_ai_business_readonly;
