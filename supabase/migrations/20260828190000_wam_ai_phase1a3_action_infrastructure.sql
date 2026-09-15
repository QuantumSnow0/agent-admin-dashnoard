-- =============================================================================
-- WAM APPS AI Phase 1A.3 — action infrastructure extensions
-- Additive only. Extends Phase 1A.2b idempotency/audit for agent, registration, lead actions.
-- =============================================================================

ALTER TABLE wam_ai.action_events
  ADD COLUMN IF NOT EXISTS previous_agent_status text,
  ADD COLUMN IF NOT EXISTS resulting_agent_status text,
  ADD COLUMN IF NOT EXISTS registration_ref text,
  ADD COLUMN IF NOT EXISTS previous_registration_status text,
  ADD COLUMN IF NOT EXISTS resulting_registration_status text,
  ADD COLUMN IF NOT EXISTS dispatch_scope_previous text,
  ADD COLUMN IF NOT EXISTS dispatch_scope_resulting text;

ALTER TABLE wam_ai.action_requests
  ADD COLUMN IF NOT EXISTS registration_ref text,
  ADD COLUMN IF NOT EXISTS target_ref text;

COMMENT ON COLUMN wam_ai.action_events.previous_agent_status IS
  'Agent account status before a WAM agent-management action.';
COMMENT ON COLUMN wam_ai.action_events.resulting_agent_status IS
  'Agent account status after a WAM agent-management action.';

-- action_requests: append-only idempotency ledger (INSERT only; no UPDATE/DELETE).
CREATE OR REPLACE FUNCTION wam_ai.action_requests_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'action_requests_immutable';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_action_requests_no_update ON wam_ai.action_requests;
CREATE TRIGGER trg_action_requests_no_update
  BEFORE UPDATE OR DELETE ON wam_ai.action_requests
  FOR EACH ROW EXECUTE FUNCTION wam_ai.action_requests_deny_mutation();

REVOKE ALL ON FUNCTION wam_ai.action_requests_deny_mutation() FROM PUBLIC, anon, authenticated;

DO $req_priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    REVOKE ALL ON FUNCTION wam_ai.action_requests_deny_mutation() FROM wam_ai_business_readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    REVOKE ALL ON FUNCTION wam_ai.action_requests_deny_mutation() FROM wam_ai_business_actions;
  END IF;
END;
$req_priv$;

CREATE OR REPLACE FUNCTION wam_ai.registration_ref(p_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT 'R-' || left(replace(p_id::text, '-', ''), 12);
$fn$;

COMMENT ON FUNCTION wam_ai.registration_ref IS
  'Safe external registration reference for MCP responses and action audit.';

CREATE OR REPLACE FUNCTION wam_ai.agent_action_fingerprint(
  p_agent_id uuid,
  p_operation text,
  p_change_token text,
  p_actor_id text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT encode(
    extensions.digest(
      coalesce(p_agent_id::text, '') || ':' ||
      coalesce(NULLIF(btrim(p_operation), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_change_token), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_actor_id), ''), ''),
      'sha256'
    ),
    'hex'
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.registration_action_fingerprint(
  p_registration_id uuid,
  p_operation text,
  p_actor_id text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT encode(
    extensions.digest(
      coalesce(p_registration_id::text, '') || ':' ||
      coalesce(NULLIF(btrim(p_operation), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_actor_id), ''), ''),
      'sha256'
    ),
    'hex'
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.lead_status_action_fingerprint(
  p_lead_id uuid,
  p_operation text,
  p_actor_id text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT encode(
    extensions.digest(
      coalesce(p_lead_id::text, '') || ':' ||
      coalesce(NULLIF(btrim(p_operation), ''), '') || ':' ||
      coalesce(NULLIF(btrim(p_actor_id), ''), ''),
      'sha256'
    ),
    'hex'
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.assert_wam_action_actor(p_actor_role text)
RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
BEGIN
  IF NULLIF(btrim(p_actor_role), '') IS NULL
     OR p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RAISE EXCEPTION 'action_not_authorized' USING ERRCODE = '42501';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai._notification_row_created(
  p_agent_id uuid,
  p_type text,
  p_since timestamptz
) RETURNS boolean
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.agent_id = p_agent_id
      AND n.type = p_type
      AND n.created_at >= p_since
  );
$fn$;

REVOKE ALL ON FUNCTION wam_ai.registration_ref(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.agent_action_fingerprint(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.registration_action_fingerprint(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.lead_status_action_fingerprint(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.assert_wam_action_actor(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai._notification_row_created(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

DO $priv$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wam_ai'
      AND p.proname IN (
        'registration_ref',
        'agent_action_fingerprint',
        'registration_action_fingerprint',
        'lead_status_action_fingerprint',
        'assert_wam_action_actor',
        '_notification_row_created'
      )
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly', r.sig);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM wam_ai_business_actions', r.sig);
    END IF;
  END LOOP;
END;
$priv$;
