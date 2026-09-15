-- =============================================================================
-- WAM APPS AI Phase 1A.7 — Operational intelligence (read-only)
-- Remediated v0.1.15: no ALTER TABLE public.*; unique-customer counts;
-- spreadsheet phone-overlap identity; hub lead_id identity; safe refs only.
-- =============================================================================

-- =============================================================================
-- WAM APPS AI Phase 1A.7 — Operational intelligence (read-only)
-- Remediated: no public.ALTER; unique-customer counting; phone-overlap identity.
-- =============================================================================

CREATE OR REPLACE FUNCTION wam_ai.reconcile_customer_batch(
  p_rows jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_input_count integer;
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

  v_input_count := jsonb_array_length(p_rows);
  IF v_input_count > 250 THEN
    RETURN jsonb_build_object(
      'status', 'error', 'operation', 'reconcile_customer_batch',
      'error_category', 'validation', 'message', 'Maximum 250 input rows allowed',
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

COMMENT ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) IS
  'MCP: wam.business.intelligence.reconcile_customer_batch — unique-customer counts; phone-overlap sheet identity; lead_id hub identity; no public ALTERs.';

CREATE OR REPLACE FUNCTION wam_ai.get_agent_lifecycle(
  p_agent_id uuid DEFAULT NULL,
  p_agent_business_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_agent_id uuid;
  v_err jsonb;
  v_name text;
  v_status text;
  v_created timestamptz;
  v_has_created boolean := false;
  v_transitions jsonb;
  v_action_evidence jsonb;
  v_first_activity timestamptz;
  v_first_activity_source text;
BEGIN
  SELECT t.v_agent_id, t.v_error INTO v_agent_id, v_err
  FROM wam_ai._resolve_agent_for_action(p_agent_id, p_agent_business_id) t;
  IF v_err IS NOT NULL THEN
    RETURN v_err || jsonb_build_object('operation', 'get_agent_lifecycle');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = v_agent_id) THEN
    RETURN jsonb_build_object(
      'status', 'not_found', 'operation', 'get_agent_lifecycle',
      'error_category', 'not_found', 'message', 'Agent not found');
  END IF;

  v_has_created := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'created_at'
  );

  IF v_has_created THEN
    EXECUTE 'SELECT name, status, created_at FROM public.agents WHERE id = $1'
      INTO v_name, v_status, v_created USING v_agent_id;
  ELSE
    SELECT a.name, a.status INTO v_name, v_status FROM public.agents a WHERE a.id = v_agent_id;
    v_created := NULL;
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'evidence_source', 'notifications.ACCOUNT_STATUS_CHANGE',
      'created_at', n.created_at,
      'title', left(coalesce(n.title, ''), 80),
      'message_preview', left(coalesce(n.message, ''), 120)
    ) ORDER BY n.created_at DESC
  ), '[]'::jsonb)
  INTO v_transitions
  FROM (
    SELECT n.created_at, n.title, n.message
    FROM public.notifications n
    WHERE n.agent_id = v_agent_id AND n.type = 'ACCOUNT_STATUS_CHANGE'
    ORDER BY n.created_at DESC LIMIT 20
  ) n;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'evidence_source', 'wam_ai.action_events',
      'created_at', e.created_at,
      'operation_name', e.operation_name,
      'previous_agent_status', e.previous_agent_status,
      'resulting_agent_status', e.resulting_agent_status,
      'outcome', e.outcome
    ) ORDER BY e.created_at DESC
  ), '[]'::jsonb)
  INTO v_action_evidence
  FROM (
    SELECT e.created_at, e.operation_name, e.previous_agent_status, e.resulting_agent_status, e.outcome
    FROM wam_ai.action_events e
    WHERE e.agent_business_ref = wam_ai.agent_business_id(v_agent_id)
      AND (e.previous_agent_status IS NOT NULL OR e.resulting_agent_status IS NOT NULL)
    ORDER BY e.created_at DESC LIMIT 20
  ) e;

  SELECT x.ts, x.src INTO v_first_activity, v_first_activity_source
  FROM (
    SELECT min(l.created_at) AS ts, 'inbound_leads.assigned'::text AS src
    FROM public.inbound_leads l WHERE l.assigned_agent_id = v_agent_id
    UNION ALL
    SELECT min(c.created_at), 'customer_registrations'
    FROM public.customer_registrations c WHERE c.agent_id = v_agent_id
    UNION ALL
    SELECT min(s.created_at), 'safaricom_registrations'
    FROM public.safaricom_registrations s WHERE s.agent_id = v_agent_id
    UNION ALL
    SELECT min(o.created_at), 'lead_offers'
    FROM public.lead_offers o WHERE o.agent_id = v_agent_id
  ) x
  WHERE x.ts IS NOT NULL
  ORDER BY x.ts ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'get_agent_lifecycle',
    'agent_business_id', wam_ai.agent_business_id(v_agent_id),
    'recipient_display_name', left(coalesce(v_name, 'Agent'), 80),
    'current_status', v_status,
    'account_created_at', v_created,
    'account_created_available', v_has_created AND v_created IS NOT NULL,
    'approved_at', NULL,
    'approved_at_available', false,
    'rejected_at', NULL,
    'rejected_at_available', false,
    'approval_rejection_timestamps_note',
      'public.agents has no approved_at or rejected_at columns; do not invent them.',
    'status_transition_evidence', v_transitions,
    'action_status_evidence', v_action_evidence,
    'first_activity_at', v_first_activity,
    'first_activity_source', v_first_activity_source,
    'first_activity_note',
      'first_activity_at is earliest operational evidence only — never treat as join or approval date.',
    'distinctions', jsonb_build_object(
      'account_created', 'agents.created_at when present in schema',
      'approved', 'not stored as a dedicated timestamp',
      'first_activity', 'earliest lead/registration/offer activity; separate from account_created',
      'current_status', 'agents.status'
    )
  );
END;
$fn$;

COMMENT ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) IS
  'MCP: wam.business.intelligence.get_agent_lifecycle — schema-confirmed lifecycle; dynamic created_at; never invents join dates.';

CREATE OR REPLACE FUNCTION wam_ai.get_notification_capability_catalogue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_items jsonb;
BEGIN
  v_items := jsonb_build_array(
    jsonb_build_object(
      'notification_type', 'SYSTEM_ANNOUNCEMENT',
      'source_producer', 'admin_dashboard_or_wam_ai_mcp',
      'eligible_recipient_type', 'agent',
      'in_app', true,
      'push', 'not_attempted_by_wam_send_rpc',
      'sms', 'separate_messaging_namespace_only',
      'ai_may_create', true,
      'internal_or_automated_only', false,
      'notes', 'Only type WAM MCP send_agent_notification may create today.'
    ),
    jsonb_build_object(
      'notification_type', 'LEAD_OFFER',
      'source_producer', 'dispatch_service',
      'eligible_recipient_type', 'agent',
      'in_app', true,
      'push', 'dispatch_pipeline',
      'sms', false,
      'ai_may_create', false,
      'internal_or_automated_only', true
    ),
    jsonb_build_object(
      'notification_type', 'LEAD_OVERDUE',
      'source_producer', 'dispatch_or_admin_jobs',
      'eligible_recipient_type', 'agent',
      'in_app', true,
      'push', 'possible',
      'sms', false,
      'ai_may_create', false,
      'internal_or_automated_only', true
    ),
    jsonb_build_object(
      'notification_type', 'LEAD_INSTALLED',
      'source_producer', 'registration_completion_triggers',
      'eligible_recipient_type', 'agent',
      'in_app', true,
      'push', 'possible',
      'sms', false,
      'ai_may_create', false,
      'internal_or_automated_only', true
    ),
    jsonb_build_object(
      'notification_type', 'REGISTRATION_STATUS_CHANGE',
      'source_producer', 'registration_status_triggers',
      'eligible_recipient_type', 'agent',
      'in_app', true,
      'push', 'possible',
      'sms', false,
      'ai_may_create', false,
      'internal_or_automated_only', true
    ),
    jsonb_build_object(
      'notification_type', 'ACCOUNT_STATUS_CHANGE',
      'source_producer', 'agent_status_triggers',
      'eligible_recipient_type', 'agent',
      'in_app', true,
      'push', 'possible',
      'sms', false,
      'ai_may_create', false,
      'internal_or_automated_only', true
    ),
    jsonb_build_object(
      'notification_type', 'EARNINGS_UPDATE',
      'source_producer', 'earnings_pipeline',
      'eligible_recipient_type', 'agent',
      'in_app', true,
      'push', 'possible',
      'sms', false,
      'ai_may_create', false,
      'internal_or_automated_only', true,
      'financial_sensitivity', true
    ),
    jsonb_build_object(
      'notification_type', 'PAYOUT_RECEIVED',
      'source_producer', 'payout_pipeline',
      'eligible_recipient_type', 'agent',
      'in_app', true,
      'push', 'possible',
      'sms', false,
      'ai_may_create', false,
      'internal_or_automated_only', true,
      'financial_sensitivity', true
    ),
    jsonb_build_object(
      'notification_type', 'SYNC_FAILURE',
      'source_producer', 'sync_jobs',
      'eligible_recipient_type', 'agent',
      'in_app', true,
      'push', 'possible',
      'sms', false,
      'ai_may_create', false,
      'internal_or_automated_only', true
    )
  );

  RETURN jsonb_build_object(
    'status', 'success',
    'operation', 'get_notification_capability_catalogue',
    'result_count', jsonb_array_length(v_items),
    'catalogue', v_items,
    'broadcast_sending', 'deferred_unavailable',
    'ai_create_allowlist', jsonb_build_array('SYSTEM_ANNOUNCEMENT'),
    'schema_source', 'public.notifications type CHECK + app NotificationType + WAM MCP allowlist',
    'caveats', jsonb_build_array(
      'Catalogue is discovery-only; it does not send notifications.',
      'WAM MCP may create SYSTEM_ANNOUNCEMENT only (Phase 1A.4).',
      'SMS agent messaging is wam.business.messaging, not a notification type.'
    )
  );
END;
$fn$;

COMMENT ON FUNCTION wam_ai.get_notification_capability_catalogue() IS
  'MCP: wam.business.intelligence.get_notification_capability_catalogue — read-only notification type discovery.';

REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.get_notification_capability_catalogue() FROM PUBLIC, anon, authenticated;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.get_notification_capability_catalogue() FROM wam_ai_business_actions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.get_notification_capability_catalogue() TO wam_ai_business_readonly';
  END IF;
END;
$priv$;
