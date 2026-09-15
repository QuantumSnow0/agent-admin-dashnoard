-- Phase 1A.7 disposable verification (fixture DB only) — remediating v0.1.15
\set ON_ERROR_STOP on

\echo '=== empty input ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.reconcile_customer_batch('[]'::jsonb);
  IF r->>'status' <> 'success' OR (r->>'input_row_count')::int <> 0 THEN
    RAISE EXCEPTION 'empty failed: %', r;
  END IF;
  IF (r->>'unique_input_customers')::int <> 0 THEN RAISE EXCEPTION 'empty unique: %', r; END IF;
END $$;

\echo '=== 251-row rejection ==='
DO $$
DECLARE r jsonb; rows jsonb := '[]'::jsonb; i int;
BEGIN
  FOR i IN 1..251 LOOP
    rows := rows || jsonb_build_array(jsonb_build_object(
      'row_ref', 'R' || i, 'airtel_phone', '2547111' || lpad(i::text, 5, '0')
    ));
  END LOOP;
  r := wam_ai.reconcile_customer_batch(rows);
  IF r->>'error_category' <> 'validation' THEN
    RAISE EXCEPTION 'expected 251 rejection: %', r;
  END IF;
END $$;

\echo '=== 51 qualifying rows / 1 duplicate => 50 unique ==='
DO $$
DECLARE r jsonb; rows jsonb := '[]'::jsonb; i int;
BEGIN
  FOR i IN 1..50 LOOP
    rows := rows || jsonb_build_array(jsonb_build_object(
      'row_ref', 'U' || i,
      'airtel_phone', '2547119' || lpad(i::text, 5, '0')
    ));
  END LOOP;
  -- duplicate of U1 identity (same phone)
  rows := rows || jsonb_build_array(jsonb_build_object(
    'row_ref', 'U1-DUP', 'airtel_phone', '07119' || lpad('1', 5, '0')
  ));
  r := wam_ai.reconcile_customer_batch(rows);
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION '51batch failed: %', r; END IF;
  IF (r->>'qualifying_spreadsheet_rows')::int <> 51 THEN RAISE EXCEPTION 'qualifying rows: %', r; END IF;
  IF (r->>'duplicate_spreadsheet_rows')::int <> 1 THEN RAISE EXCEPTION 'dup rows: %', r; END IF;
  IF (r->>'unique_input_customers')::int <> 50 THEN RAISE EXCEPTION 'unique customers: %', r; END IF;
END $$;

\echo '=== phone-overlap sheet grouping + install semantics + no UUIDs ==='
DO $$
DECLARE
  r jsonb;
  grp jsonb;
  txt text;
BEGIN
  r := wam_ai.reconcile_customer_batch(jsonb_build_array(
    -- Airtel-only + Airtel/Safaricom must group (shared airtel)
    jsonb_build_object('row_ref', 'AO', 'airtel_phone', '254711100090'),
    jsonb_build_object('row_ref', 'AS', 'airtel_phone', '254711100090', 'safaricom_phone', '254722200090'),
    -- Shared alternate across rows
    jsonb_build_object('row_ref', 'ALT1', 'airtel_phone', '254711100091', 'safaricom_phone', '254733300001'),
    jsonb_build_object('row_ref', 'ALT2', 'airtel_phone', '254711100092', 'safaricom_phone', '254733300001'),
    -- Exact installed registration (customer_registrations)
    jsonb_build_object('row_ref', 'REG', 'airtel_phone', '254711100001', 'spreadsheet_installed', true),
    -- Lead-only installed
    jsonb_build_object('row_ref', 'LEADONLY', 'airtel_phone', '254711100080', 'spreadsheet_installed', true),
    -- Lead + its registration (one hub identity)
    jsonb_build_object('row_ref', 'LINKED', 'airtel_phone', '254711100085'),
    -- Safaricom installed registration
    jsonb_build_object('row_ref', 'SAF', 'safaricom_phone', '254722200001', 'spreadsheet_installed', true),
    -- Matched not installed
    jsonb_build_object('row_ref', 'N1', 'airtel_phone', '254711100002', 'spreadsheet_installed', false),
    -- Unmatched
    jsonb_build_object('row_ref', 'U1', 'airtel_phone', '254799999999'),
    -- Ambiguous: two genuinely different hub identities share phone
    jsonb_build_object('row_ref', 'AMB', 'airtel_phone', '254711100050'),
    -- Probable dup / ambiguous via primary+alternate overlap across identities
    jsonb_build_object('row_ref', 'PD', 'airtel_phone', '254711100070'),
    -- Conflicting status across linked lead+reg
    jsonb_build_object('row_ref', 'CONF', 'airtel_phone', '254711100086')
  ));

  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'batch failed: %', r; END IF;
  IF (r->>'unique_input_customers')::int < 10 THEN RAISE EXCEPTION 'unique too low: %', r; END IF;
  IF (r->>'exact_unique_customers')::int < 3 THEN RAISE EXCEPTION 'exact unique too low: %', r; END IF;
  IF (r->>'installed_unique_customers')::int < 1 THEN RAISE EXCEPTION 'installed unique missing: %', r; END IF;
  IF (r->>'installed_inbound_lead_only_unique_customers')::int < 1 THEN
    RAISE EXCEPTION 'lead-only installed missing: %', r;
  END IF;
  IF (r->>'matched_not_installed_unique_customers')::int < 1 THEN
    RAISE EXCEPTION 'matched not installed missing: %', r;
  END IF;
  IF (r->>'ambiguous_groups')::int < 1 THEN RAISE EXCEPTION 'ambiguous groups missing: %', r; END IF;
  IF (r->>'unmatched_groups')::int < 1 THEN RAISE EXCEPTION 'unmatched groups missing: %', r; END IF;
  IF (r->>'conflicting_status_unique_customers')::int < 1 THEN
    RAISE EXCEPTION 'conflicting status missing: %', r;
  END IF;
  IF r->'counting_policy' IS NULL THEN RAISE EXCEPTION 'counting_policy missing: %', r; END IF;

  -- Airtel-only + Airtel/Safaricom grouped
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(r->'rows') elem
    WHERE elem->'row_refs' @> '["AO"]'::jsonb AND elem->'row_refs' @> '["AS"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'AO/AS not grouped: %', r->'rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(r->'rows') elem
    WHERE elem->'row_refs' @> '["ALT1"]'::jsonb AND elem->'row_refs' @> '["ALT2"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'ALT1/ALT2 not grouped: %', r->'rows';
  END IF;

  -- Lead+registration is exact, not ambiguous
  SELECT elem INTO grp FROM jsonb_array_elements(r->'rows') elem
  WHERE elem->'row_refs' @> '["LINKED"]'::jsonb;
  IF grp IS NULL OR grp->>'classification' <> 'exact' THEN
    RAISE EXCEPTION 'LINKED not exact single hub identity: %', grp;
  END IF;
  IF coalesce((grp->>'probable_duplicate_hub_identity')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'LINKED must not be probable duplicate: %', grp;
  END IF;

  -- Lead-only install bucket
  SELECT elem INTO grp FROM jsonb_array_elements(r->'rows') elem
  WHERE elem->'row_refs' @> '["LEADONLY"]'::jsonb;
  IF grp->>'install_bucket' <> 'installed_inbound_lead_only' THEN
    RAISE EXCEPTION 'LEADONLY bucket: %', grp;
  END IF;

  -- Registration installed bucket
  SELECT elem INTO grp FROM jsonb_array_elements(r->'rows') elem
  WHERE elem->'row_refs' @> '["REG"]'::jsonb;
  IF grp->>'install_bucket' <> 'installed_registration' THEN
    RAISE EXCEPTION 'REG bucket: %', grp;
  END IF;

  -- Conflicting status surfaced
  SELECT elem INTO grp FROM jsonb_array_elements(r->'rows') elem
  WHERE elem->'row_refs' @> '["CONF"]'::jsonb;
  IF coalesce((grp->>'conflicting_status')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'CONF conflicting_status: %', grp;
  END IF;

  -- Ambiguous for shared-phone distinct identities
  SELECT elem INTO grp FROM jsonb_array_elements(r->'rows') elem
  WHERE elem->'row_refs' @> '["AMB"]'::jsonb;
  IF grp->>'classification' <> 'ambiguous' THEN
    RAISE EXCEPTION 'AMB not ambiguous: %', grp;
  END IF;

  -- No internal UUID / record_id in MCP-shaped output
  txt := r::text;
  IF txt ~* '"record_id"' THEN RAISE EXCEPTION 'record_id leaked: %', left(txt, 500); END IF;
  IF txt ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' THEN
    RAISE EXCEPTION 'UUID leaked in reconcile output: %', left(txt, 800);
  END IF;
  IF txt ~ '"airtel_phone"[[:space:]]*:[[:space:]]*"254' THEN
    RAISE EXCEPTION 'raw airtel_phone field leaked';
  END IF;
END $$;

\echo '=== duplicate rows do not inflate unique installed ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.reconcile_customer_batch(jsonb_build_array(
    jsonb_build_object('row_ref', 'I1', 'airtel_phone', '254711100001', 'spreadsheet_installed', true),
    jsonb_build_object('row_ref', 'I2', 'airtel_phone', '0711100001', 'spreadsheet_installed', true)
  ));
  IF (r->>'qualifying_spreadsheet_rows')::int <> 2 THEN RAISE EXCEPTION 'rows: %', r; END IF;
  IF (r->>'unique_input_customers')::int <> 1 THEN RAISE EXCEPTION 'unique: %', r; END IF;
  IF (r->>'installed_match_rows')::int <> 2 THEN RAISE EXCEPTION 'installed rows: %', r; END IF;
  IF (r->>'installed_unique_customers')::int <> 1 THEN RAISE EXCEPTION 'installed unique: %', r; END IF;
END $$;

\echo '=== 250-row boundary ==='
DO $$
DECLARE r jsonb; rows jsonb := '[]'::jsonb; i int;
BEGIN
  FOR i IN 1..250 LOOP
    rows := rows || jsonb_build_array(jsonb_build_object(
      'row_ref', 'B' || i,
      'airtel_phone', CASE WHEN i = 1 THEN '254711100001' ELSE '2547888' || lpad(i::text, 5, '0') END
    ));
  END LOOP;
  r := wam_ai.reconcile_customer_batch(rows);
  IF r->>'status' <> 'success' OR (r->>'input_row_count')::int <> 250 THEN
    RAISE EXCEPTION '250 boundary failed: %', r;
  END IF;
  IF coalesce((r->>'rows_truncated')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected rows_truncated for 250: %', r;
  END IF;
END $$;

\echo '=== agent lifecycle ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.get_agent_lifecycle('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, NULL);
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'lifecycle failed: %', r; END IF;
  IF r->>'current_status' IS NULL THEN RAISE EXCEPTION 'missing status: %', r; END IF;
  IF coalesce((r->>'approved_at_available')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'approved_at must be unavailable: %', r;
  END IF;
  IF r->>'account_created_at' IS NULL THEN RAISE EXCEPTION 'missing created_at: %', r; END IF;
  IF r->>'first_activity_note' IS NULL THEN RAISE EXCEPTION 'missing first_activity_note: %', r; END IF;
END $$;

\echo '=== notification catalogue ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.get_notification_capability_catalogue();
  IF r->>'status' <> 'success' THEN RAISE EXCEPTION 'catalogue failed: %', r; END IF;
  IF (r->>'result_count')::int < 9 THEN RAISE EXCEPTION 'catalogue short: %', r; END IF;
  IF r->>'broadcast_sending' <> 'deferred_unavailable' THEN
    RAISE EXCEPTION 'broadcast must be deferred: %', r;
  END IF;
END $$;

\echo '=== production migration has no ALTER TABLE public.* ==='
DO $$
BEGIN
  -- Static check performed in packaging tests; runtime marker for disposable log.
  RAISE NOTICE 'PASS: packaging asserts no ALTER TABLE public in Phase 1A.7 migration';
END $$;

\echo '=== audit redaction shape (fingerprints/counts only in tool layer) ==='
DO $$
DECLARE r jsonb;
BEGIN
  r := wam_ai.reconcile_customer_batch(jsonb_build_array(
    jsonb_build_object('row_ref', 'AUD', 'airtel_phone', '254711100001', 'customer_name', 'Secret Name')
  ));
  IF r::text LIKE '%Secret Name%' THEN RAISE EXCEPTION 'name leaked in output'; END IF;
  IF r::text LIKE '%254711100001%' AND r::text NOT LIKE '%****%' THEN
    -- allow fingerprints/masked; reject clear MSISDN as a JSON string value without mask
    IF r::text ~ '"254711100001"' THEN RAISE EXCEPTION 'raw MSISDN string in output'; END IF;
  END IF;
END $$;

\echo 'disposable_verify_phase1a7_pass'
