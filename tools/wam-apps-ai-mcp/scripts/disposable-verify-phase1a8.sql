-- Phase 1A.8 disposable verification
\set ON_ERROR_STOP on

\echo '=== session ownership / expiry / replay ==='
DO $$
DECLARE
  b jsonb; a jsonb; f jsonb; f2 jsonb;
  expired_token text;
BEGIN
  b := wam_ai.begin_reconcile_session('fp' || repeat('a', 32), '11111111-1111-4111-8111-111111111111'::text,
    'unverified:owner', 'technical_owner', 30);
  IF b->>'status' <> 'success' THEN RAISE EXCEPTION 'begin failed: %', b; END IF;

  a := wam_ai.append_reconcile_session_rows(
    b->>'session_token',
    jsonb_build_array(jsonb_build_object('row_ref','r1','airtel_phone','254711810001')),
    'other-actor', 'technical_owner');
  IF a->>'error_category' <> 'action_not_authorized' THEN
    RAISE EXCEPTION 'expected ownership mismatch: %', a;
  END IF;

  a := wam_ai.append_reconcile_session_rows(
    b->>'session_token',
    jsonb_build_array(jsonb_build_object('row_ref','r1','airtel_phone','254711810001')),
    'unverified:owner', 'technical_owner');
  IF a->>'status' <> 'success' THEN RAISE EXCEPTION 'append failed: %', a; END IF;

  f := wam_ai.finalize_reconcile_session(b->>'session_token', 'unverified:owner', 'technical_owner');
  IF f->>'status' <> 'success' THEN RAISE EXCEPTION 'finalize failed: %', f; END IF;

  f2 := wam_ai.finalize_reconcile_session(b->>'session_token', 'unverified:owner', 'technical_owner');
  IF coalesce((f2->>'idempotent_replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected finalize replay: %', f2;
  END IF;

  -- expired session
  b := wam_ai.begin_reconcile_session('fp' || repeat('c', 32), '33333333-3333-4333-8333-333333333333',
    'unverified:owner', 'technical_owner', 1);
  expired_token := b->>'session_token';
  UPDATE wam_ai.reconcile_sessions SET expires_at = now() - interval '1 minute' WHERE id = expired_token::uuid;
  a := wam_ai.append_reconcile_session_rows(
    expired_token,
    jsonb_build_array(jsonb_build_object('row_ref','e1','airtel_phone','254711810099')),
    'unverified:owner', 'technical_owner');
  IF a->>'error_category' <> 'session_expired' THEN
    RAISE EXCEPTION 'expected expired: %', a;
  END IF;
END $$;

\echo '=== cross-chunk finalize uses one identity graph (not summed) ==='
DO $$
DECLARE
  b jsonb; f jsonb; i int; chunk jsonb := '[]'::jsonb;
BEGIN
  b := wam_ai.begin_reconcile_session('fp' || repeat('b', 32), '22222222-2222-4222-8222-222222222222',
    'unverified:owner', 'technical_owner', 30);
  -- 251 rows: 250 unique + duplicate of first spanning chunks
  FOR i IN 1..250 LOOP
    chunk := chunk || jsonb_build_array(jsonb_build_object(
      'row_ref', 'C' || i,
      'airtel_phone', '25471182' || lpad(i::text, 4, '0')
    ));
  END LOOP;
  PERFORM wam_ai.append_reconcile_session_rows(b->>'session_token', chunk, 'unverified:owner', 'technical_owner');
  PERFORM wam_ai.append_reconcile_session_rows(
    b->>'session_token',
    jsonb_build_array(jsonb_build_object('row_ref','C1-DUP','airtel_phone','254711820001')),
    'unverified:owner', 'technical_owner');
  f := wam_ai.finalize_reconcile_session(b->>'session_token', 'unverified:owner', 'technical_owner');
  IF f->>'status' <> 'success' THEN RAISE EXCEPTION 'cross-chunk finalize: %', f; END IF;
  IF (f->>'qualifying_spreadsheet_rows')::int <> 251 THEN RAISE EXCEPTION 'qualifying: %', f; END IF;
  IF (f->>'unique_input_customers')::int <> 250 THEN RAISE EXCEPTION 'unique should merge cross-chunk: %', f; END IF;
  IF coalesce((f->>'raw_rows_deleted')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected raw_rows_deleted: %', f;
  END IF;
  IF (SELECT count(*) FROM wam_ai.reconcile_session_rows WHERE session_id = (b->>'session_token')::uuid) <> 0 THEN
    RAISE EXCEPTION 'raw session rows should be wiped after finalize';
  END IF;
END $$;

\echo '=== direct batch hard-capped at 250 even when GUC is raised ==='
DO $$
DECLARE
  rows jsonb := '[]'::jsonb;
  r jsonb;
  i int;
BEGIN
  SET wam_ai.reconcile_max_rows = '5000';
  FOR i IN 1..251 LOOP
    rows := rows || jsonb_build_array(jsonb_build_object(
      'row_ref', 'D' || i,
      'airtel_phone', '25471183' || lpad(i::text, 4, '0')
    ));
  END LOOP;
  r := wam_ai.reconcile_customer_batch(rows);
  IF r->>'status' <> 'error' OR r->>'error_category' <> 'validation' THEN
    RAISE EXCEPTION 'expected direct >250 rejection: %', r;
  END IF;
  IF position('250' in coalesce(r->>'message', '')) = 0 THEN
    RAISE EXCEPTION 'expected 250 cap message: %', r;
  END IF;
END $$;

\echo '=== session path accepts >250 (bounded private 5000) ==='
DO $$
DECLARE
  b jsonb; f jsonb; i int; chunk jsonb;
BEGIN
  b := wam_ai.begin_reconcile_session('fp' || repeat('d', 32), '44444444-4444-4444-8444-444444444444',
    'unverified:owner', 'technical_owner', 30);
  chunk := '[]'::jsonb;
  FOR i IN 1..250 LOOP
    chunk := chunk || jsonb_build_array(jsonb_build_object(
      'row_ref', 'L' || i,
      'airtel_phone', '25471184' || lpad(i::text, 4, '0')
    ));
  END LOOP;
  PERFORM wam_ai.append_reconcile_session_rows(b->>'session_token', chunk, 'unverified:owner', 'technical_owner');
  chunk := '[]'::jsonb;
  FOR i IN 251..300 LOOP
    chunk := chunk || jsonb_build_array(jsonb_build_object(
      'row_ref', 'L' || i,
      'airtel_phone', '25471184' || lpad(i::text, 4, '0')
    ));
  END LOOP;
  PERFORM wam_ai.append_reconcile_session_rows(b->>'session_token', chunk, 'unverified:owner', 'technical_owner');
  f := wam_ai.finalize_reconcile_session(b->>'session_token', 'unverified:owner', 'technical_owner');
  IF f->>'status' <> 'success' THEN RAISE EXCEPTION '300-row session finalize: %', f; END IF;
  IF (f->>'input_row_count')::int <> 300 THEN RAISE EXCEPTION 'expected 300 input rows: %', f; END IF;
  IF coalesce((f->>'raw_rows_deleted')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'expected raw_rows_deleted on 300 finalize: %', f;
  END IF;
  IF (SELECT count(*) FROM wam_ai.reconcile_session_rows WHERE session_id = (b->>'session_token')::uuid) <> 0 THEN
    RAISE EXCEPTION 'raw rows remain after 300 finalize';
  END IF;
END $$;

\echo '=== readonly ACL: cleanup_own yes; cleanup_expired / private session helpers no ==='
DO $$
DECLARE
  rows jsonb := '[]'::jsonb;
  r jsonb;
  i int;
BEGIN
  SET ROLE wam_ai_business_readonly;

  BEGIN
    PERFORM wam_ai.cleanup_expired_reconcile_sessions(24);
    RAISE EXCEPTION 'readonly should not EXECUTE cleanup_expired_reconcile_sessions';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  r := wam_ai.cleanup_own_reconcile_sessions('unverified:owner', 'technical_owner', 24);
  IF r->>'status' <> 'success' THEN
    RAISE EXCEPTION 'cleanup_own as readonly failed: %', r;
  END IF;

  BEGIN
    PERFORM wam_ai._reconcile_customer_batch_session('[]'::jsonb);
    RAISE EXCEPTION 'readonly should not EXECUTE _reconcile_customer_batch_session';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM wam_ai._reconcile_customer_batch_internal('[]'::jsonb, 5000);
    RAISE EXCEPTION 'readonly should not EXECUTE _reconcile_customer_batch_internal';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  -- GUC set by readonly must not raise the public direct batch above 250
  SET wam_ai.reconcile_max_rows = '5000';
  FOR i IN 1..251 LOOP
    rows := rows || jsonb_build_array(jsonb_build_object(
      'row_ref', 'R' || i,
      'airtel_phone', '25471185' || lpad(i::text, 4, '0')
    ));
  END LOOP;
  r := wam_ai.reconcile_customer_batch(rows);
  IF r->>'status' <> 'error' OR r->>'error_category' <> 'validation' THEN
    RAISE EXCEPTION 'readonly GUC must not bypass 250 direct cap: %', r;
  END IF;

  RESET ROLE;
END $$;

\echo '=== synthetic 51/50/38/29/12/1 semantics via reconcile_customer_batch ==='
DO $$
DECLARE
  rows jsonb := '[]'::jsonb;
  r jsonb;
  i int;
BEGIN
  FOR i IN 1..50 LOOP
    rows := rows || jsonb_build_array(jsonb_build_object(
      'row_ref', 'S' || i,
      'airtel_phone', '25471181' || lpad(i::text, 4, '0'),
      'spreadsheet_installed', true
    ));
  END LOOP;
  rows := rows || jsonb_build_array(jsonb_build_object(
    'row_ref', 'S1D', 'airtel_phone', '0711810001', 'spreadsheet_installed', true
  ));
  r := wam_ai.reconcile_customer_batch(rows);
  IF (r->>'qualifying_spreadsheet_rows')::int <> 51 THEN RAISE EXCEPTION '51 rows: %', r; END IF;
  IF (r->>'duplicate_spreadsheet_rows')::int <> 1 THEN RAISE EXCEPTION '1 dup: %', r; END IF;
  IF (r->>'unique_input_customers')::int <> 50 THEN RAISE EXCEPTION '50 unique: %', r; END IF;
  IF (r->>'exact_unique_customers')::int <> 38 THEN RAISE EXCEPTION '38 exact: %', r; END IF;
  IF (r->>'installed_unique_customers')::int <> 29 THEN RAISE EXCEPTION '29 installed: %', r; END IF;
  IF (r->>'unmatched_groups')::int <> 12 THEN RAISE EXCEPTION '12 unmatched: %', r; END IF;
END $$;

\echo 'disposable_verify_phase1a8_pass'
