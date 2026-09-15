-- =============================================================================
-- WAM APPS AI Phase 1A.2b — action infrastructure (idempotency + action audit)
-- Additive only. No production role creation in this migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS wam_ai.action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL,
  operation_name text NOT NULL,
  correlation_id uuid NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  request_fingerprint text NOT NULL,
  lead_ref text,
  agent_business_ref text,
  outcome text NOT NULL,
  error_category text,
  offer_ref text,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT action_requests_idempotency_op UNIQUE (idempotency_key, operation_name)
);

CREATE INDEX IF NOT EXISTS idx_action_requests_correlation
  ON wam_ai.action_requests (correlation_id);

COMMENT ON TABLE wam_ai.action_requests IS
  'Server-side idempotency for WAM AI business action RPCs. Stores safe replay payloads only.';

CREATE TABLE IF NOT EXISTS wam_ai.action_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  operation_name text NOT NULL,
  lead_ref text,
  agent_business_ref text,
  previous_lead_status text,
  resulting_lead_status text,
  offer_ref text,
  radius_exception_used boolean,
  outcome text NOT NULL,
  error_category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_events_correlation
  ON wam_ai.action_events (correlation_id);

COMMENT ON TABLE wam_ai.action_events IS
  'Immutable transactional audit for WAM AI business actions. No PII or coordinates.';

CREATE OR REPLACE FUNCTION wam_ai.action_events_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'action_events_immutable';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_action_events_no_update ON wam_ai.action_events;
CREATE TRIGGER trg_action_events_no_update
  BEFORE UPDATE OR DELETE ON wam_ai.action_events
  FOR EACH ROW EXECUTE FUNCTION wam_ai.action_events_deny_mutation();

-- Trigger-only helper: revoke direct EXECUTE (trigger invocation does not require caller EXECUTE).
REVOKE ALL ON FUNCTION wam_ai.action_events_deny_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION wam_ai.action_events_deny_mutation() FROM anon, authenticated;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    REVOKE ALL ON FUNCTION wam_ai.action_events_deny_mutation() FROM wam_ai_business_readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    REVOKE ALL ON FUNCTION wam_ai.action_events_deny_mutation() FROM wam_ai_business_actions;
  END IF;
END;
$priv$;

CREATE OR REPLACE FUNCTION wam_ai.offer_ref(p_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT 'O-' || left(replace(p_id::text, '-', ''), 12);
$fn$;

COMMENT ON FUNCTION wam_ai.offer_ref IS
  'Safe external offer reference for MCP responses and action audit.';

CREATE OR REPLACE FUNCTION wam_ai.resolve_agent_id_from_business_ref(p_ref text)
RETURNS uuid
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT a.id
  FROM public.agents a
  WHERE wam_ai.agent_business_id(a.id) = wam_ai.normalize_agent_business_ref(p_ref)
  ORDER BY a.id
  LIMIT 1;
$fn$;

-- Returns NULL when zero matches; raises ambiguous when >1 (caller handles via count)
DROP FUNCTION IF EXISTS wam_ai.action_request_fingerprint(uuid, uuid);
CREATE OR REPLACE FUNCTION wam_ai.action_request_fingerprint(
  p_lead_id uuid,
  p_agent_id uuid,
  p_actor_id text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT encode(
    extensions.digest(
      p_lead_id::text || ':' || p_agent_id::text || ':' || coalesce(NULLIF(btrim(p_actor_id), ''), ''),
      'sha256'
    ),
    'hex'
  );
$fn$;

COMMENT ON FUNCTION wam_ai.action_request_fingerprint(uuid, uuid, text) IS
  'Idempotency fingerprint: lead + agent + verified actor. No PII.';

REVOKE ALL ON TABLE wam_ai.action_requests FROM PUBLIC;
REVOKE ALL ON TABLE wam_ai.action_events FROM PUBLIC;
REVOKE ALL ON TABLE wam_ai.action_requests FROM anon, authenticated;
REVOKE ALL ON TABLE wam_ai.action_events FROM anon, authenticated;
