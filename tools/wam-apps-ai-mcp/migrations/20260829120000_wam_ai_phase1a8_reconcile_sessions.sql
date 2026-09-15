-- =============================================================================
-- WAM APPS AI Phase 1A.8 — Bounded reconcile sessions (cross-chunk identity)
-- Read-only Hub matching; no public table ALTERs; no raw audit of phones/names.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wam_ai.reconcile_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_actor_id text NOT NULL,
  owner_actor_role text NOT NULL,
  document_fingerprint text NOT NULL,
  idempotency_key text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'finalizing', 'finalized', 'expired', 'failed')),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0 AND row_count <= 5000),
  result_payload jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CONSTRAINT reconcile_sessions_idem UNIQUE (owner_actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS wam_ai.reconcile_session_rows (
  session_id uuid NOT NULL REFERENCES wam_ai.reconcile_sessions(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  row_ref text NOT NULL,
  airtel_phone text,
  safaricom_phone text,
  spreadsheet_installed boolean,
  PRIMARY KEY (session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS reconcile_sessions_expires_idx
  ON wam_ai.reconcile_sessions (expires_at)
  WHERE status = 'open';

ALTER TABLE wam_ai.reconcile_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wam_ai.reconcile_session_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconcile_sessions_deny_all ON wam_ai.reconcile_sessions;
CREATE POLICY reconcile_sessions_deny_all ON wam_ai.reconcile_sessions
  FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS reconcile_session_rows_deny_all ON wam_ai.reconcile_session_rows;
CREATE POLICY reconcile_session_rows_deny_all ON wam_ai.reconcile_session_rows
  FOR ALL TO public USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE wam_ai.reconcile_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE wam_ai.reconcile_session_rows FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- begin_reconcile_session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_ai.begin_reconcile_session(
  p_document_fingerprint text,
  p_idempotency_key text,
  p_actor_id text,
  p_actor_role text,
  p_ttl_minutes integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wam_ai, extensions, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid;
  v_existing wam_ai.reconcile_sessions%ROWTYPE;
  v_ttl integer := greatest(1, least(coalesce(p_ttl_minutes, 30), 120));
BEGIN
  IF NULLIF(btrim(p_document_fingerprint), '') IS NULL OR length(p_document_fingerprint) < 16 THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','document_fingerprint required');
  END IF;
  IF NULLIF(btrim(p_actor_id), '') IS NULL OR NULLIF(btrim(p_actor_role), '') IS NULL THEN
    RETURN jsonb_build_object('status','error','error_category','validation','message','actor required');
  END IF;
  IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status','error','error_category','action_not_authorized','message','Actor role not authorized');
  END IF;

  -- expire stale
  UPDATE wam_ai.reconcile_sessions
  SET status = 'expired'
  WHERE status = 'open' AND expires_at < now();

  IF NULLIF(btrim(p_idempotency_key), '') IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM wam_ai.reconcile_sessions
    WHERE owner_actor_id = p_actor_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.document_fingerprint IS DISTINCT FROM p_document_fingerprint THEN
        RETURN jsonb_build_object(
          'status','error','error_category','idempotency_conflict',
          'message','Idempotency key reused with different document fingerprint');
      END IF;
      RETURN jsonb_build_object(
        'status','success','operation','begin_reconcile_session',
        'session_ref', 'S-' || left(replace(v_existing.id::text,'-',''), 12),
        'session_token', v_existing.id::text,
        'idempotent_replay', true,
        'expires_at', v_existing.expires_at,
        'row_count', v_existing.row_count,
        'session_status', v_existing.status
      );
    END IF;
  END IF;

  INSERT INTO wam_ai.reconcile_sessions (
    owner_actor_id, owner_actor_role, document_fingerprint, idempotency_key, expires_at
  ) VALUES (
    p_actor_id, p_actor_role, p_document_fingerprint,
    NULLIF(btrim(p_idempotency_key), ''),
    now() + make_interval(mins => v_ttl)
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'status','success','operation','begin_reconcile_session',
    'session_ref', 'S-' || left(replace(v_id::text,'-',''), 12),
    'session_token', v_id::text,
    'idempotent_replay', false,
    'expires_at', now() + make_interval(mins => v_ttl),
    'row_count', 0,
    'session_status', 'open'
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- append_reconcile_session_rows
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- finalize_reconcile_session — single identity merge via reconcile_customer_batch
-- ---------------------------------------------------------------------------
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

  -- Raise per-call cap for this transaction only (public callers stay at 250).
  PERFORM set_config('wam_ai.reconcile_max_rows', '5000', true);
  v_result := wam_ai.reconcile_customer_batch(v_rows);

  UPDATE wam_ai.reconcile_sessions
  SET status = 'finalized', finalized_at = now(), result_payload = v_result
  WHERE id = v_id;

  RETURN v_result || jsonb_build_object(
    'session_ref', 'S-' || left(replace(v_id::text,'-',''), 12),
    'session_finalized', true,
    'idempotent_replay', false
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- cleanup_expired_reconcile_sessions — delete expired / stale sessions (PII wipe)
-- ---------------------------------------------------------------------------
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

COMMENT ON FUNCTION wam_ai.begin_reconcile_session(text, text, text, text, integer) IS
  'MCP documents: begin bounded reconcile session for cross-chunk identity merge.';
COMMENT ON FUNCTION wam_ai.append_reconcile_session_rows(text, jsonb, text, text) IS
  'MCP documents: append ≤250 rows to open reconcile session.';
COMMENT ON FUNCTION wam_ai.finalize_reconcile_session(text, text, text) IS
  'MCP documents: finalize session with single identity-aware reconcile; never sum chunk totals.';
COMMENT ON FUNCTION wam_ai.cleanup_expired_reconcile_sessions(integer) IS
  'MCP/ops: delete expired reconcile sessions and cascaded row PII.';

REVOKE ALL ON FUNCTION wam_ai.begin_reconcile_session(text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.append_reconcile_session_rows(text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.finalize_reconcile_session(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.cleanup_expired_reconcile_sessions(integer) FROM PUBLIC, anon, authenticated;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.begin_reconcile_session(text, text, text, text, integer) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.append_reconcile_session_rows(text, jsonb, text, text) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.finalize_reconcile_session(text, text, text) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.cleanup_expired_reconcile_sessions(integer) FROM wam_ai_business_actions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.begin_reconcile_session(text, text, text, text, integer) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.append_reconcile_session_rows(text, jsonb, text, text) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.finalize_reconcile_session(text, text, text) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.cleanup_expired_reconcile_sessions(integer) TO wam_ai_business_readonly';
  END IF;
END;
$priv$;
