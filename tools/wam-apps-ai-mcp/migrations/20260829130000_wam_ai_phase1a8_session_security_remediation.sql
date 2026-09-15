-- =============================================================================
-- Phase 1A.8 session security remediation (post v0.1.17 / for MCP v0.1.18)
-- - Remove caller-settable GUC bypass for >250 reconcile
-- - Private session reconciler (5000) callable only from finalize (DEFINER)
-- - Wipe raw session rows after finalize / expiry
-- - Global cleanup not granted to readonly; owner-scoped cleanup instead
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai._reconcile_customer_batch_internal(
  p_rows jsonb,
  p_max_rows integer
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_input_count integer;
  v_max_rows integer;
  v_result jsonb;
  v_detail jsonb;
  v_detail_count integer;
  v_max_detail integer := 100;
  v_counting_policy jsonb := jsonb_build_object(
    'installed_unique_customers',
      'Exact-match unique input customers whose hub identity includes at least one installed registration (customer_registrations or safaricom_registrations). Inbound-lead-only installed is excluded.',
    'installed_inbound_lead_only_unique_customers',
      'Exact-match unique input customers with an installed inbound lead and no installed registration.',
    'matched_not_installed_unique_customers',
      'Exact-match unique input customers with neither installed registration nor installed inbound lead.',
    'primary_business_totals',
      'Prefer *_unique_customers / *_groups for business answers; *_rows can include spreadsheet duplicates.',
    'identity_policy',
      'Spreadsheet identities: connected components over shared normalized MSISDN. Hub identities: inbound_lead linked to customer_registration via inbound_lead_id only; unlinked records that share a phone stay separate (ambiguous when both match). Names never connect.'
  );
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', 'reconcile_customer_batch',
      'error_category', 'validation', 'message', 'rows must be a JSON array');
  END IF;

  v_max_rows := least(5000, greatest(1, coalesce(p_max_rows, 250)));

  v_input_count := jsonb_array_length(p_rows);
  IF v_input_count > v_max_rows THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', 'reconcile_customer_batch',
      'error_category', 'validation',
      'message', format('Maximum %s input rows allowed', v_max_rows),
      'input_row_count', v_input_count);
  END IF;

  IF v_input_count = 0 THEN
    RETURN jsonb_build_object(
      'status', 'success', 'operation', 'reconcile_customer_batch',
      'input_row_count', 0,
      'qualifying_spreadsheet_rows', 0,
      'duplicate_spreadsheet_rows', 0,
      'unique_input_customers', 0,
      'exact_match_rows', 0, 'exact_unique_customers', 0,
      'installed_match_rows', 0, 'installed_unique_customers', 0,
      'installed_inbound_lead_only_rows', 0, 'installed_inbound_lead_only_unique_customers', 0,
      'matched_not_installed_rows', 0, 'matched_not_installed_unique_customers', 0,
      'ambiguous_rows', 0, 'ambiguous_groups', 0,
      'unmatched_rows', 0, 'unmatched_groups', 0,
      'registration_match_unique_customers', 0,
      'inbound_lead_only_match_unique_customers', 0,
      'airtel_registration_match_unique_customers', 0,
      'safaricom_registration_match_unique_customers', 0,
      'conflicting_status_unique_customers', 0,
      'probable_duplicate_hub_identity_flags', 0,
      'rows', '[]'::jsonb, 'rows_truncated', false, 'rows_returned', 0,
      'match_policy', 'exact_normalized_phone_connected_components',
      'counting_policy', v_counting_policy,
      'caveats', jsonb_build_array(
        'Names are never used as confirmed matches.',
        'Phones are masked in results; audit stores fingerprints/counts only.'
      )
    );
  END IF;

  WITH RECURSIVE
  raw AS (
    SELECT
      ordinality::integer AS ordinal,
      coalesce(nullif(btrim(elem->>'row_ref'), ''), 'row-' || ordinality::text) AS row_ref,
      nullif(btrim(elem->>'airtel_phone'), '') AS airtel_raw,
      nullif(btrim(elem->>'safaricom_phone'), '') AS safaricom_raw,
      CASE
        WHEN elem ? 'spreadsheet_installed' AND jsonb_typeof(elem->'spreadsheet_installed') = 'boolean'
          THEN (elem->>'spreadsheet_installed')::boolean
        WHEN lower(coalesce(elem->>'spreadsheet_installed', '')) IN ('true', 'yes', '1', 'installed') THEN true
        WHEN lower(coalesce(elem->>'spreadsheet_installed', '')) IN ('false', 'no', '0', 'not_installed') THEN false
        ELSE NULL
      END AS spreadsheet_installed
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, ordinality)
  ),
  input_rows AS (
    SELECT
      r.ordinal, r.row_ref, r.spreadsheet_installed,
      wam_ai.normalize_kenyan_msisdn(r.airtel_raw) AS airtel_msisdn,
      wam_ai.normalize_kenyan_msisdn(r.safaricom_raw) AS safaricom_msisdn,
      (wam_ai.normalize_kenyan_msisdn(r.airtel_raw) IS NOT NULL
        OR wam_ai.normalize_kenyan_msisdn(r.safaricom_raw) IS NOT NULL) AS qualifying,
      CASE WHEN wam_ai.normalize_kenyan_msisdn(r.airtel_raw) IS NOT NULL
        THEN wam_ai.mask_kenyan_msisdn(wam_ai.normalize_kenyan_msisdn(r.airtel_raw)) END AS airtel_masked,
      CASE WHEN wam_ai.normalize_kenyan_msisdn(r.safaricom_raw) IS NOT NULL
        THEN wam_ai.mask_kenyan_msisdn(wam_ai.normalize_kenyan_msisdn(r.safaricom_raw)) END AS safaricom_masked,
      CASE WHEN wam_ai.normalize_kenyan_msisdn(r.airtel_raw) IS NOT NULL
        THEN wam_ai.sms_destination_fingerprint(wam_ai.normalize_kenyan_msisdn(r.airtel_raw)) END AS airtel_fp,
      CASE WHEN wam_ai.normalize_kenyan_msisdn(r.safaricom_raw) IS NOT NULL
        THEN wam_ai.sms_destination_fingerprint(wam_ai.normalize_kenyan_msisdn(r.safaricom_raw)) END AS safaricom_fp
    FROM raw r
  ),
  row_phones AS (
    SELECT i.ordinal, i.airtel_msisdn AS msisdn FROM input_rows i WHERE i.airtel_msisdn IS NOT NULL
    UNION
    SELECT i.ordinal, i.safaricom_msisdn FROM input_rows i WHERE i.safaricom_msisdn IS NOT NULL
  ),
  input_msisdns AS (SELECT DISTINCT msisdn FROM row_phones),
  sheet_edges AS (
    SELECT DISTINCT least(a.ordinal, b.ordinal) AS n1, greatest(a.ordinal, b.ordinal) AS n2
    FROM row_phones a
    JOIN row_phones b ON a.msisdn = b.msisdn AND a.ordinal < b.ordinal
  ),
  sheet_reach AS (
    SELECT i.ordinal AS node, i.ordinal AS reached
    FROM input_rows i WHERE i.qualifying
    UNION
    SELECT sr.node, CASE WHEN se.n1 = sr.reached THEN se.n2 ELSE se.n1 END
    FROM sheet_reach sr
    JOIN sheet_edges se ON se.n1 = sr.reached OR se.n2 = sr.reached
  ),
  sheet_components AS (
    SELECT node AS ordinal, min(reached) AS group_id FROM sheet_reach GROUP BY node
  ),
  sheet_groups AS (
    SELECT
      sc.group_id AS input_group_id,
      count(*)::int AS row_count,
      array_agg(i.row_ref ORDER BY i.ordinal) AS row_refs,
      bool_or(i.spreadsheet_installed IS TRUE) AS any_spreadsheet_installed,
      bool_or(i.spreadsheet_installed IS FALSE) AS any_spreadsheet_not_installed,
      min(i.ordinal) AS sort_ordinal
    FROM sheet_components sc
    JOIN input_rows i ON i.ordinal = sc.ordinal
    GROUP BY sc.group_id
  ),
  sheet_group_phones AS (
    SELECT DISTINCT sc.group_id AS input_group_id, rp.msisdn
    FROM sheet_components sc
    JOIN row_phones rp ON rp.ordinal = sc.ordinal
  ),
  hub_phone_hits AS (
    SELECT 'inbound_lead'::text AS source_type, l.id AS record_id, phone.msisdn
    FROM public.inbound_leads l
    CROSS JOIN LATERAL (VALUES
      (wam_ai.normalize_kenyan_msisdn(l.primary_phone)),
      (wam_ai.normalize_kenyan_msisdn(l.alternate_phone))
    ) AS phone(msisdn)
    WHERE phone.msisdn IS NOT NULL AND phone.msisdn IN (SELECT msisdn FROM input_msisdns)
    UNION ALL
    SELECT 'customer_registration', c.id, phone.msisdn
    FROM public.customer_registrations c
    CROSS JOIN LATERAL (VALUES
      (wam_ai.normalize_kenyan_msisdn(c.airtel_number)),
      (wam_ai.normalize_kenyan_msisdn(c.alternate_number))
    ) AS phone(msisdn)
    WHERE phone.msisdn IS NOT NULL AND phone.msisdn IN (SELECT msisdn FROM input_msisdns)
    UNION ALL
    SELECT 'safaricom_registration', s.id, phone.msisdn
    FROM public.safaricom_registrations s
    CROSS JOIN LATERAL (VALUES
      (wam_ai.normalize_kenyan_msisdn(s.safaricom_number)),
      (wam_ai.normalize_kenyan_msisdn(s.alternate_number))
    ) AS phone(msisdn)
    WHERE phone.msisdn IS NOT NULL AND phone.msisdn IN (SELECT msisdn FROM input_msisdns)
  ),
  hub_hit_keys AS (
    SELECT DISTINCT source_type || ':' || record_id::text AS record_key FROM hub_phone_hits
  ),
  hub_expanded_keys AS (
    SELECT record_key FROM hub_hit_keys
    UNION
    SELECT 'inbound_lead:' || c.inbound_lead_id::text
    FROM public.customer_registrations c
    WHERE c.inbound_lead_id IS NOT NULL
      AND ('customer_registration:' || c.id::text) IN (SELECT record_key FROM hub_hit_keys)
    UNION
    SELECT 'customer_registration:' || c.id::text
    FROM public.customer_registrations c
    WHERE c.inbound_lead_id IS NOT NULL
      AND ('inbound_lead:' || c.inbound_lead_id::text) IN (SELECT record_key FROM hub_hit_keys)
  ),
  hub_records AS (
    SELECT
      'inbound_lead:' || l.id::text AS record_key,
      'inbound_lead'::text AS source_type,
      'inbound_lead'::text AS record_kind,
      l.id AS record_id,
      l.status AS hub_status,
      (l.status = 'installed' OR l.installed_at IS NOT NULL) AS installed,
      coalesce(l.product, 'unknown') AS product,
      NULL::uuid AS linked_lead_id
    FROM public.inbound_leads l
    WHERE ('inbound_lead:' || l.id::text) IN (SELECT record_key FROM hub_expanded_keys)
    UNION ALL
    SELECT
      'customer_registration:' || c.id::text,
      'customer_registration', 'airtel_registration', c.id, c.status,
      (c.status = 'installed'), 'airtel', c.inbound_lead_id
    FROM public.customer_registrations c
    WHERE ('customer_registration:' || c.id::text) IN (SELECT record_key FROM hub_expanded_keys)
    UNION ALL
    SELECT
      'safaricom_registration:' || s.id::text,
      'safaricom_registration', 'safaricom_registration', s.id, s.status,
      (s.status = 'installed'), 'safaricom', NULL::uuid
    FROM public.safaricom_registrations s
    WHERE ('safaricom_registration:' || s.id::text) IN (SELECT record_key FROM hub_expanded_keys)
  ),
  hub_phones AS (
    SELECT hr.record_key, phone.msisdn, phone.phone_role
    FROM hub_records hr
    JOIN public.inbound_leads l ON hr.source_type = 'inbound_lead' AND l.id = hr.record_id
    CROSS JOIN LATERAL (VALUES
      (wam_ai.normalize_kenyan_msisdn(l.primary_phone), 'primary'),
      (wam_ai.normalize_kenyan_msisdn(l.alternate_phone), 'alternate')
    ) AS phone(msisdn, phone_role)
    WHERE phone.msisdn IS NOT NULL
    UNION ALL
    SELECT hr.record_key, phone.msisdn, phone.phone_role
    FROM hub_records hr
    JOIN public.customer_registrations c ON hr.source_type = 'customer_registration' AND c.id = hr.record_id
    CROSS JOIN LATERAL (VALUES
      (wam_ai.normalize_kenyan_msisdn(c.airtel_number), 'primary'),
      (wam_ai.normalize_kenyan_msisdn(c.alternate_number), 'alternate')
    ) AS phone(msisdn, phone_role)
    WHERE phone.msisdn IS NOT NULL
    UNION ALL
    SELECT hr.record_key, phone.msisdn, phone.phone_role
    FROM hub_records hr
    JOIN public.safaricom_registrations s ON hr.source_type = 'safaricom_registration' AND s.id = hr.record_id
    CROSS JOIN LATERAL (VALUES
      (wam_ai.normalize_kenyan_msisdn(s.safaricom_number), 'primary'),
      (wam_ai.normalize_kenyan_msisdn(s.alternate_number), 'alternate')
    ) AS phone(msisdn, phone_role)
    WHERE phone.msisdn IS NOT NULL
  ),
  -- Conservative hub identity: link lead↔registration via inbound_lead_id only.
  -- Shared phones across otherwise unlinked records stay separate identities → ambiguous.
  hub_edges AS (
    SELECT DISTINCT least(l.record_key, c.record_key) AS k1, greatest(l.record_key, c.record_key) AS k2
    FROM hub_records l
    JOIN hub_records c
      ON l.source_type = 'inbound_lead'
     AND c.source_type = 'customer_registration'
     AND c.linked_lead_id = l.record_id
  ),
  hub_reach AS (
    SELECT hr.record_key AS node, hr.record_key AS reached FROM hub_records hr
    UNION
    SELECT r.node, CASE WHEN e.k1 = r.reached THEN e.k2 ELSE e.k1 END
    FROM hub_reach r
    JOIN hub_edges e ON e.k1 = r.reached OR e.k2 = r.reached
  ),
  hub_components AS (
    SELECT node AS record_key, min(reached) AS hub_group_id FROM hub_reach GROUP BY node
  ),
  hub_group_phones AS (
    SELECT DISTINCT hc.hub_group_id, hp.msisdn
    FROM hub_components hc JOIN hub_phones hp ON hp.record_key = hc.record_key
  ),
  hub_group_stats AS (
    SELECT
      hc.hub_group_id,
      count(*)::int AS record_count,
      bool_or(hr.source_type IN ('customer_registration', 'safaricom_registration')) AS has_registration,
      bool_or(hr.source_type = 'inbound_lead') AS has_lead,
      bool_or(hr.source_type = 'customer_registration') AS has_airtel_registration,
      bool_or(hr.source_type = 'safaricom_registration') AS has_safaricom_registration,
      bool_or(hr.source_type IN ('customer_registration', 'safaricom_registration') AND hr.installed) AS has_installed_registration,
      bool_or(hr.source_type IN ('customer_registration', 'safaricom_registration') AND NOT hr.installed) AS has_non_installed_registration,
      bool_or(hr.source_type = 'inbound_lead' AND hr.installed) AS has_installed_lead,
      bool_or(hr.source_type = 'inbound_lead' AND NOT hr.installed) AS has_non_installed_lead
    FROM hub_components hc
    JOIN hub_records hr ON hr.record_key = hc.record_key
    GROUP BY hc.hub_group_id
  ),
  group_matches AS (
    SELECT DISTINCT sgp.input_group_id, hgp.hub_group_id
    FROM sheet_group_phones sgp
    JOIN hub_group_phones hgp ON hgp.msisdn = sgp.msisdn
  ),
  group_match_counts AS (
    SELECT sg.input_group_id, count(gm.hub_group_id)::int AS hub_group_count
    FROM sheet_groups sg
    LEFT JOIN group_matches gm ON gm.input_group_id = sg.input_group_id
    GROUP BY sg.input_group_id
  ),
  matched_hub_detail AS (
    SELECT
      gm.input_group_id, hr.source_type, hr.record_kind, hr.hub_status, hr.installed, hr.product,
      hp.phone_role, hp.msisdn,
      CASE WHEN hr.source_type = 'inbound_lead' THEN wam_ai.lead_ref(hr.record_id)
           ELSE wam_ai.registration_ref(hr.record_id) END AS safe_ref
    FROM group_matches gm
    JOIN hub_components hc ON hc.hub_group_id = gm.hub_group_id
    JOIN hub_records hr ON hr.record_key = hc.record_key
    JOIN hub_phones hp ON hp.record_key = hr.record_key
    JOIN sheet_group_phones sgp ON sgp.input_group_id = gm.input_group_id AND sgp.msisdn = hp.msisdn
  ),
  group_hub_matches_json AS (
    SELECT m.input_group_id,
      coalesce(jsonb_agg(DISTINCT jsonb_strip_nulls(jsonb_build_object(
        'source_type', m.source_type,
        'record_kind', m.record_kind,
        'lead_ref', CASE WHEN m.source_type = 'inbound_lead' THEN m.safe_ref END,
        'registration_ref', CASE WHEN m.source_type <> 'inbound_lead' THEN m.safe_ref END,
        'status', m.hub_status,
        'installed', m.installed,
        'product', m.product,
        'matched_phone_role', m.phone_role,
        'matched_phone_masked', wam_ai.mask_kenyan_msisdn(m.msisdn)
      ))), '[]'::jsonb) AS hub_matches
    FROM matched_hub_detail m
    GROUP BY m.input_group_id
  ),
  group_classified AS (
    SELECT
      sg.input_group_id, sg.row_count, sg.row_refs, sg.sort_ordinal,
      sg.any_spreadsheet_installed, sg.any_spreadsheet_not_installed,
      gmc.hub_group_count,
      CASE WHEN gmc.hub_group_count = 0 THEN 'unmatched'
           WHEN gmc.hub_group_count = 1 THEN 'exact'
           ELSE 'ambiguous' END AS classification,
      coalesce(bool_or(hgs.has_registration), false) AS has_registration,
      coalesce(bool_or(hgs.has_lead) AND NOT bool_or(hgs.has_registration), false) AS inbound_lead_only,
      coalesce(bool_or(hgs.has_airtel_registration), false) AS has_airtel_registration,
      coalesce(bool_or(hgs.has_safaricom_registration), false) AS has_safaricom_registration,
      coalesce(bool_or(hgs.has_installed_registration), false) AS has_installed_registration,
      coalesce(bool_or(hgs.has_installed_lead), false) AS has_installed_lead,
      coalesce(bool_or(
        (hgs.has_installed_registration AND hgs.has_non_installed_registration)
        OR (hgs.has_installed_lead AND hgs.has_non_installed_lead)
        OR (hgs.has_installed_registration AND hgs.has_non_installed_lead)
        OR (hgs.has_installed_lead AND hgs.has_non_installed_registration)
      ), false) AS conflicting_status,
      (gmc.hub_group_count > 1) AS probable_duplicate_hub_identity,
      CASE
        WHEN gmc.hub_group_count = 1 AND coalesce(bool_or(hgs.has_installed_registration), false)
          THEN 'installed_registration'
        WHEN gmc.hub_group_count = 1 AND coalesce(bool_or(hgs.has_installed_lead), false)
          AND NOT coalesce(bool_or(hgs.has_installed_registration), false)
          THEN 'installed_inbound_lead_only'
        WHEN gmc.hub_group_count = 1 THEN 'matched_not_installed'
        ELSE NULL
      END AS install_bucket,
      CASE
        WHEN gmc.hub_group_count <> 1 THEN 'not_compared'
        WHEN NOT sg.any_spreadsheet_installed AND NOT sg.any_spreadsheet_not_installed THEN 'not_compared'
        WHEN sg.any_spreadsheet_installed
          AND coalesce(bool_or(hgs.has_installed_registration OR hgs.has_installed_lead), false)
          THEN 'agree_installed'
        WHEN sg.any_spreadsheet_not_installed
          AND NOT coalesce(bool_or(hgs.has_installed_registration OR hgs.has_installed_lead), false)
          THEN 'agree_not_installed'
        WHEN sg.any_spreadsheet_installed
          AND NOT coalesce(bool_or(hgs.has_installed_registration OR hgs.has_installed_lead), false)
          THEN 'spreadsheet_says_installed_hub_does_not'
        WHEN sg.any_spreadsheet_not_installed
          AND coalesce(bool_or(hgs.has_installed_registration OR hgs.has_installed_lead), false)
          THEN 'hub_installed_spreadsheet_does_not'
        ELSE 'not_compared'
      END AS install_comparison
    FROM sheet_groups sg
    JOIN group_match_counts gmc ON gmc.input_group_id = sg.input_group_id
    LEFT JOIN group_matches gm ON gm.input_group_id = sg.input_group_id
    LEFT JOIN hub_group_stats hgs ON hgs.hub_group_id = gm.hub_group_id
    GROUP BY sg.input_group_id, sg.row_count, sg.row_refs, sg.sort_ordinal,
      sg.any_spreadsheet_installed, sg.any_spreadsheet_not_installed, gmc.hub_group_count
  ),
  row_classified AS (
    SELECT i.ordinal, i.qualifying, gc.classification, gc.install_bucket
    FROM input_rows i
    LEFT JOIN sheet_components sc ON sc.ordinal = i.ordinal
    LEFT JOIN group_classified gc ON gc.input_group_id = sc.group_id
  ),
  totals AS (
    SELECT
      (SELECT count(*)::int FROM input_rows WHERE qualifying) AS qualifying_spreadsheet_rows,
      (SELECT count(*)::int FROM sheet_groups) AS unique_input_customers,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'exact') AS exact_unique_customers,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'ambiguous') AS ambiguous_groups,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'unmatched') AS unmatched_groups,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'exact' AND install_bucket = 'installed_registration') AS installed_unique_customers,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'exact' AND install_bucket = 'installed_inbound_lead_only') AS installed_inbound_lead_only_unique_customers,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'exact' AND install_bucket = 'matched_not_installed') AS matched_not_installed_unique_customers,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'exact' AND has_registration) AS registration_match_unique_customers,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'exact' AND inbound_lead_only) AS inbound_lead_only_match_unique_customers,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'exact' AND has_airtel_registration) AS airtel_registration_match_unique_customers,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'exact' AND has_safaricom_registration) AS safaricom_registration_match_unique_customers,
      (SELECT count(*)::int FROM group_classified WHERE classification = 'exact' AND conflicting_status) AS conflicting_status_unique_customers,
      (SELECT count(*)::int FROM group_classified WHERE probable_duplicate_hub_identity OR classification = 'ambiguous') AS probable_duplicate_hub_identity_flags,
      (SELECT count(*)::int FROM row_classified WHERE qualifying AND classification = 'exact') AS exact_match_rows,
      (SELECT count(*)::int FROM row_classified WHERE qualifying AND install_bucket = 'installed_registration') AS installed_match_rows,
      (SELECT count(*)::int FROM row_classified WHERE qualifying AND install_bucket = 'installed_inbound_lead_only') AS installed_inbound_lead_only_rows,
      (SELECT count(*)::int FROM row_classified WHERE qualifying AND install_bucket = 'matched_not_installed') AS matched_not_installed_rows,
      (SELECT count(*)::int FROM row_classified WHERE qualifying AND classification = 'ambiguous') AS ambiguous_rows,
      (SELECT count(*)::int FROM row_classified WHERE qualifying AND classification = 'unmatched') AS unmatched_rows
  ),
  detail_json AS (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'input_group_id', gc.input_group_id,
        'row_refs', to_jsonb(gc.row_refs),
        'row_count', gc.row_count,
        'classification', gc.classification,
        'install_bucket', gc.install_bucket,
        'install_comparison', gc.install_comparison,
        'has_registration', gc.has_registration,
        'inbound_lead_only', gc.inbound_lead_only,
        'has_airtel_registration', gc.has_airtel_registration,
        'has_safaricom_registration', gc.has_safaricom_registration,
        'has_installed_registration', gc.has_installed_registration,
        'has_installed_lead', gc.has_installed_lead,
        'conflicting_status', gc.conflicting_status,
        'probable_duplicate_hub_identity', gc.probable_duplicate_hub_identity,
        'airtel_phone_masked', i.airtel_masked,
        'safaricom_phone_masked', i.safaricom_masked,
        'airtel_phone_fingerprint', i.airtel_fp,
        'safaricom_phone_fingerprint', i.safaricom_fp,
        'hub_matches', coalesce(hm.hub_matches, '[]'::jsonb)
      ) ORDER BY gc.sort_ordinal
    ), '[]'::jsonb) AS detail
    FROM group_classified gc
    JOIN input_rows i ON i.ordinal = gc.sort_ordinal
    LEFT JOIN group_hub_matches_json hm ON hm.input_group_id = gc.input_group_id
  )
  SELECT
    jsonb_build_object(
      'status', 'success',
      'operation', 'reconcile_customer_batch',
      'input_row_count', v_input_count,
      'qualifying_spreadsheet_rows', t.qualifying_spreadsheet_rows,
      'duplicate_spreadsheet_rows', t.qualifying_spreadsheet_rows - t.unique_input_customers,
      'unique_input_customers', t.unique_input_customers,
      'exact_match_rows', t.exact_match_rows,
      'exact_unique_customers', t.exact_unique_customers,
      'installed_match_rows', t.installed_match_rows,
      'installed_unique_customers', t.installed_unique_customers,
      'installed_inbound_lead_only_rows', t.installed_inbound_lead_only_rows,
      'installed_inbound_lead_only_unique_customers', t.installed_inbound_lead_only_unique_customers,
      'matched_not_installed_rows', t.matched_not_installed_rows,
      'matched_not_installed_unique_customers', t.matched_not_installed_unique_customers,
      'ambiguous_rows', t.ambiguous_rows,
      'ambiguous_groups', t.ambiguous_groups,
      'unmatched_rows', t.unmatched_rows,
      'unmatched_groups', t.unmatched_groups,
      'registration_match_unique_customers', t.registration_match_unique_customers,
      'inbound_lead_only_match_unique_customers', t.inbound_lead_only_match_unique_customers,
      'airtel_registration_match_unique_customers', t.airtel_registration_match_unique_customers,
      'safaricom_registration_match_unique_customers', t.safaricom_registration_match_unique_customers,
      'conflicting_status_unique_customers', t.conflicting_status_unique_customers,
      'probable_duplicate_hub_identity_flags', t.probable_duplicate_hub_identity_flags,
      'match_policy', 'exact_normalized_phone_connected_components',
      'counting_policy', v_counting_policy,
      'caveats', jsonb_build_array(
        'Names are never used as confirmed matches.',
        'Prefer unique_input_customers and *_unique_customers for business answers.',
        'installed_unique_customers excludes inbound-lead-only installed.',
        'Phones are masked; detail truncated to 100 groups.'
      )
    ),
    d.detail
  INTO v_result, v_detail
  FROM totals t CROSS JOIN detail_json d;

  v_detail_count := coalesce(jsonb_array_length(v_detail), 0);
  RETURN v_result || jsonb_build_object(
    'rows', CASE WHEN v_detail_count > v_max_detail THEN (
      SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
      FROM (SELECT elem FROM jsonb_array_elements(v_detail) WITH ORDINALITY t(elem, ord) WHERE ord <= v_max_detail) x
    ) ELSE v_detail END,
    'rows_truncated', v_detail_count > v_max_detail,
    'rows_returned', least(v_detail_count, v_max_detail)
  );
END;
$fn$;

-- Public direct path: hard 250, no GUC
CREATE OR REPLACE FUNCTION wam_ai.reconcile_customer_batch(
  p_rows jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
  SELECT wam_ai._reconcile_customer_batch_internal(p_rows, 250);
$fn$;

-- Session-only path: 5000 max — EXECUTE revoked from all login roles
CREATE OR REPLACE FUNCTION wam_ai._reconcile_customer_batch_session(
  p_rows jsonb
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
  SELECT wam_ai._reconcile_customer_batch_internal(p_rows, 5000);
$fn$;

REVOKE ALL ON FUNCTION wam_ai._reconcile_customer_batch_internal(jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._reconcile_customer_batch_session(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM PUBLIC, anon, authenticated;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai._reconcile_customer_batch_internal(jsonb, integer) FROM wam_ai_business_readonly';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai._reconcile_customer_batch_session(jsonb) FROM wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) TO wam_ai_business_readonly';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai._reconcile_customer_batch_internal(jsonb, integer) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai._reconcile_customer_batch_session(jsonb) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM wam_ai_business_actions';
  END IF;
END;
$priv$;

CREATE OR REPLACE FUNCTION wam_ai.finalize_reconcile_session(
  p_session_token text,
  p_actor_id text,
  p_actor_role text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_sess wam_ai.reconcile_sessions%ROWTYPE;
  v_rows jsonb;
  v_result jsonb;
BEGIN
  BEGIN
    v_id := p_session_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','Invalid session_token');
  END;

  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status','error','error_category','action_not_authorized','message','Actor role not authorized');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text, 0));

  SELECT * INTO v_sess FROM wam_ai.reconcile_sessions WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','error_category','not_found','message','Session not found');
  END IF;
  IF v_sess.owner_actor_id IS DISTINCT FROM p_actor_id OR v_sess.owner_actor_role IS DISTINCT FROM p_actor_role THEN
    RETURN jsonb_build_object('status','error','error_category','action_not_authorized','message','Session ownership mismatch');
  END IF;
  IF v_sess.status = 'finalized' AND v_sess.result_payload IS NOT NULL THEN
    RETURN v_sess.result_payload || jsonb_build_object('idempotent_replay', true);
  END IF;
  IF v_sess.status <> 'open' OR v_sess.expires_at < now() THEN
    IF v_sess.status = 'open' THEN
      UPDATE wam_ai.reconcile_sessions SET status = 'expired' WHERE id = v_id;
      DELETE FROM wam_ai.reconcile_session_rows WHERE session_id = v_id;
    END IF;
    RETURN jsonb_build_object('status','error','error_category','session_expired','message','Session not open');
  END IF;
  IF v_sess.row_count = 0 THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','Session has no rows');
  END IF;

  UPDATE wam_ai.reconcile_sessions SET status = 'finalizing' WHERE id = v_id;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'row_ref', r.row_ref,
      'airtel_phone', r.airtel_phone,
      'safaricom_phone', r.safaricom_phone,
      'spreadsheet_installed', r.spreadsheet_installed
    ) ORDER BY r.ordinal
  ), '[]'::jsonb)
  INTO v_rows
  FROM wam_ai.reconcile_session_rows r
  WHERE r.session_id = v_id;

  v_result := wam_ai._reconcile_customer_batch_session(v_rows);

  UPDATE wam_ai.reconcile_sessions
  SET status = 'finalized', finalized_at = now(), result_payload = v_result
  WHERE id = v_id;

  DELETE FROM wam_ai.reconcile_session_rows WHERE session_id = v_id;

  RETURN v_result || jsonb_build_object(
    'session_ref', 'S-' || left(replace(v_id::text,'-',''), 12),
    'session_finalized', true,
    'idempotent_replay', false,
    'raw_rows_deleted', true
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.append_reconcile_session_rows(
  p_session_token text,
  p_rows jsonb,
  p_actor_id text,
  p_actor_role text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_sess wam_ai.reconcile_sessions%ROWTYPE;
  v_len integer;
  v_i integer;
  v_elem jsonb;
  v_ord integer;
BEGIN
  BEGIN
    v_id := p_session_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','Invalid session_token');
  END;

  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status','error','error_category','action_not_authorized','message','Actor role not authorized');
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','rows must be array');
  END IF;
  v_len := jsonb_array_length(p_rows);
  IF v_len = 0 OR v_len > 250 THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','Append chunks must be 1..250 rows');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text, 0));

  SELECT * INTO v_sess FROM wam_ai.reconcile_sessions WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','error_category','not_found','message','Session not found');
  END IF;
  IF v_sess.owner_actor_id IS DISTINCT FROM p_actor_id OR v_sess.owner_actor_role IS DISTINCT FROM p_actor_role THEN
    RETURN jsonb_build_object('status','error','error_category','action_not_authorized','message','Session ownership mismatch');
  END IF;
  IF v_sess.status <> 'open' OR v_sess.expires_at < now() THEN
    IF v_sess.status = 'open' THEN
      UPDATE wam_ai.reconcile_sessions SET status = 'expired' WHERE id = v_id;
      DELETE FROM wam_ai.reconcile_session_rows WHERE session_id = v_id;
    END IF;
    RETURN jsonb_build_object('status','error','error_category','session_expired','message','Session not open');
  END IF;
  IF v_sess.row_count + v_len > 5000 THEN
    RETURN jsonb_build_object('status','error','error_category','limits','message','Session row limit 5000 exceeded');
  END IF;

  v_ord := v_sess.row_count;
  FOR v_i IN 0..v_len-1 LOOP
    v_elem := p_rows->v_i;
    v_ord := v_ord + 1;
    INSERT INTO wam_ai.reconcile_session_rows (
      session_id, ordinal, row_ref, airtel_phone, safaricom_phone, spreadsheet_installed
    ) VALUES (
      v_id,
      v_ord,
      coalesce(nullif(btrim(v_elem->>'row_ref'), ''), 'row-' || v_ord::text),
      nullif(btrim(v_elem->>'airtel_phone'), ''),
      nullif(btrim(v_elem->>'safaricom_phone'), ''),
      CASE
        WHEN v_elem ? 'spreadsheet_installed' AND jsonb_typeof(v_elem->'spreadsheet_installed') = 'boolean'
          THEN (v_elem->>'spreadsheet_installed')::boolean
        ELSE NULL
      END
    );
  END LOOP;

  UPDATE wam_ai.reconcile_sessions SET row_count = v_ord WHERE id = v_id;

  RETURN jsonb_build_object(
    'status','success','operation','append_reconcile_session_rows',
    'session_ref', 'S-' || left(replace(v_id::text,'-',''), 12),
    'row_count', v_ord,
    'appended', v_len
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.cleanup_expired_reconcile_sessions(
  p_max_age_hours integer DEFAULT 24
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_deleted integer;
  v_hours integer := greatest(1, least(coalesce(p_max_age_hours, 24), 168));
BEGIN
  UPDATE wam_ai.reconcile_sessions
  SET status = 'expired'
  WHERE status IN ('open', 'finalizing') AND expires_at < now();

  DELETE FROM wam_ai.reconcile_session_rows r
  USING wam_ai.reconcile_sessions s
  WHERE r.session_id = s.id
    AND s.status IN ('expired', 'failed')
    AND coalesce(s.finalized_at, s.expires_at, s.created_at) < now() - make_interval(hours => v_hours);

  DELETE FROM wam_ai.reconcile_sessions
  WHERE status IN ('expired', 'failed', 'finalized')
    AND coalesce(finalized_at, expires_at, created_at) < now() - make_interval(hours => v_hours);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'cleanup_expired_reconcile_sessions',
    'sessions_deleted', v_deleted
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.cleanup_own_reconcile_sessions(
  p_actor_id text,
  p_actor_role text,
  p_max_age_hours integer DEFAULT 24
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_deleted integer;
  v_hours integer := greatest(1, least(coalesce(p_max_age_hours, 24), 168));
BEGIN
  IF NULLIF(btrim(p_actor_id), '') IS NULL OR p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status','error','error_category','action_not_authorized','message','Actor required');
  END IF;

  UPDATE wam_ai.reconcile_sessions
  SET status = 'expired'
  WHERE owner_actor_id = p_actor_id
    AND owner_actor_role = p_actor_role
    AND status IN ('open', 'finalizing') AND expires_at < now();

  DELETE FROM wam_ai.reconcile_session_rows r
  USING wam_ai.reconcile_sessions s
  WHERE r.session_id = s.id
    AND s.owner_actor_id = p_actor_id
    AND s.owner_actor_role = p_actor_role
    AND s.status IN ('expired', 'failed', 'finalized')
    AND coalesce(s.finalized_at, s.expires_at, s.created_at) < now() - make_interval(hours => v_hours);

  DELETE FROM wam_ai.reconcile_sessions
  WHERE owner_actor_id = p_actor_id
    AND owner_actor_role = p_actor_role
    AND status IN ('expired', 'failed', 'finalized')
    AND coalesce(finalized_at, expires_at, created_at) < now() - make_interval(hours => v_hours);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'cleanup_own_reconcile_sessions',
    'sessions_deleted', v_deleted
  );
END;
$fn$;

REVOKE ALL ON FUNCTION wam_ai.cleanup_expired_reconcile_sessions(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.cleanup_own_reconcile_sessions(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.finalize_reconcile_session(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.append_reconcile_session_rows(text, jsonb, text, text) FROM PUBLIC, anon, authenticated;

DO $priv2$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.cleanup_expired_reconcile_sessions(integer) FROM wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.cleanup_own_reconcile_sessions(text, text, integer) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.finalize_reconcile_session(text, text, text) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.append_reconcile_session_rows(text, jsonb, text, text) TO wam_ai_business_readonly';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.cleanup_expired_reconcile_sessions(integer) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.cleanup_own_reconcile_sessions(text, text, integer) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai._reconcile_customer_batch_session(jsonb) FROM wam_ai_business_actions';
  END IF;
END;
$priv2$;

COMMENT ON FUNCTION wam_ai._reconcile_customer_batch_internal(jsonb, integer) IS
  'Private reconcile core; not granted to login roles.';
COMMENT ON FUNCTION wam_ai._reconcile_customer_batch_session(jsonb) IS
  'Session finalize only; max 5000; not granted to login roles.';
COMMENT ON FUNCTION wam_ai.cleanup_expired_reconcile_sessions(integer) IS
  'Privileged ops global cleanup — not granted to wam_ai_business_readonly.';
COMMENT ON FUNCTION wam_ai.cleanup_own_reconcile_sessions(text, text, integer) IS
  'Owner-scoped session cleanup for readonly MCP actors.';
