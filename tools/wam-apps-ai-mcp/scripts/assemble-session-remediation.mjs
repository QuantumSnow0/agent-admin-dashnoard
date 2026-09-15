import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminRoot = path.resolve(mcpRoot, "../..");
const internalPath = path.join(mcpRoot, "_internal_body.sql");
const outPath = path.join(
  adminRoot,
  "supabase/migrations/20260829130000_wam_ai_phase1a8_session_security_remediation.sql",
);

const internal = fs.readFileSync(internalPath, "utf8").trimEnd();

const header = `-- =============================================================================
-- Phase 1A.8 session security remediation (post v0.1.17 / for MCP v0.1.18)
-- - Remove caller-settable GUC bypass for >250 reconcile
-- - Private session reconciler (5000) callable only from finalize (DEFINER)
-- - Wipe raw session rows after finalize / expiry
-- - Global cleanup not granted to readonly; owner-scoped cleanup instead
-- =============================================================================

`;

const footer = `

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
`;

fs.writeFileSync(outPath, header + internal + footer);
const mcpCopy = path.join(
  mcpRoot,
  "migrations/20260829130000_wam_ai_phase1a8_session_security_remediation.sql",
);
fs.copyFileSync(outPath, mcpCopy);
console.log("wrote", outPath);
console.log("copied", mcpCopy);
