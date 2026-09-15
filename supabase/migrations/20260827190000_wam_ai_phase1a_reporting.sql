-- =============================================================================
-- WAM APPS AI Phase 1A — read-only reporting + audit (Agent Hub)
-- Local implementation only until production approval.
-- Does NOT create role passwords. Does NOT weaken operational RLS.
-- Does NOT alter privileges on existing public.* functions
--   (see 20260827191500_wam_ai_phase1a_public_privilege_hardening.sql).
-- Future role: wam_ai_business_readonly (see deployment runbook).
-- Date-range contract: MCP rejects >90d; SQL clamps to max_range_days (<=90).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS wam_ai;
COMMENT ON SCHEMA wam_ai IS
  'WAM APPS AI Phase 1A reporting + audit. Callers use SECURITY DEFINER RPCs only.';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS wam_ai.reporting_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_range_days integer NOT NULL DEFAULT 7 CHECK (default_range_days BETWEEN 1 AND 90),
  max_range_days integer NOT NULL DEFAULT 90 CHECK (max_range_days BETWEEN 1 AND 90),
  default_list_limit integer NOT NULL DEFAULT 50 CHECK (default_list_limit BETWEEN 1 AND 100),
  max_list_limit integer NOT NULL DEFAULT 100 CHECK (max_list_limit BETWEEN 1 AND 100),
  dispatch_backlog_hours integer NOT NULL DEFAULT 1,
  kyc_stalled_hours integer NOT NULL DEFAULT 24,
  installation_followup_hours integer NOT NULL DEFAULT 48,
  pending_install_review_hours integer NOT NULL DEFAULT 24,
  opaque_ref_pepper text NOT NULL DEFAULT 'wam_ai_phase1a_ref_v1',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO wam_ai.reporting_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE wam_ai.reporting_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wam_ai.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  instance_id text,
  actor_id text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN (
    'technical_owner','business_partner','ai_service','system_maintenance','unknown')),
  identity_verified boolean NOT NULL DEFAULT false,
  session_or_channel_id text,
  operation_name text NOT NULL,
  tool_namespace text NOT NULL DEFAULT 'wam.business.analytics',
  param_hash text,
  param_redacted jsonb,
  data_classification text NOT NULL DEFAULT 'internal_operational'
    CHECK (data_classification IN (
      'safe_aggregate','internal_operational','personal_minimized','denied')),
  result_count integer,
  outcome text NOT NULL CHECK (outcome IN ('success','denied','failure')),
  error_category text,
  duration_ms integer
);
CREATE INDEX IF NOT EXISTS idx_wam_ai_audit_created ON wam_ai.audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wam_ai_audit_actor ON wam_ai.audit_events (actor_role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wam_ai_audit_correlation ON wam_ai.audit_events (correlation_id);
CREATE INDEX IF NOT EXISTS idx_wam_ai_audit_instance ON wam_ai.audit_events (instance_id, created_at DESC);
ALTER TABLE wam_ai.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wam_ai_audit_deny_all ON wam_ai.audit_events;
CREATE POLICY wam_ai_audit_deny_all ON wam_ai.audit_events
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION wam_ai.audit_reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'wam_ai.audit_events is append-only';
END;
$fn$;
DROP TRIGGER IF EXISTS trg_wam_ai_audit_no_update ON wam_ai.audit_events;
CREATE TRIGGER trg_wam_ai_audit_no_update
  BEFORE UPDATE OR DELETE ON wam_ai.audit_events
  FOR EACH ROW EXECUTE FUNCTION wam_ai.audit_reject_mutation();

CREATE OR REPLACE FUNCTION wam_ai.cfg()
RETURNS wam_ai.reporting_config
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT * FROM wam_ai.reporting_config WHERE id = 1;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.clamp_range(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(range_from timestamptz, range_to timestamptz)
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE
  c wam_ai.reporting_config;
  v_to timestamptz;
  v_from timestamptz;
  v_max integer;
BEGIN
  c := wam_ai.cfg();
  v_max := LEAST(c.max_range_days, 90);
  v_to := COALESCE(p_to, now());
  v_from := COALESCE(p_from, v_to - make_interval(days => c.default_range_days));
  IF v_from > v_to THEN RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = '22023'; END IF;
  -- Defense in depth: clamp (MCP rejects >90d before call)
  IF v_to - v_from > make_interval(days => v_max) THEN
    v_from := v_to - make_interval(days => v_max);
  END IF;
  range_from := v_from; range_to := v_to; RETURN NEXT;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.clamp_limit(p_limit integer)
RETURNS integer LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE c wam_ai.reporting_config;
BEGIN
  c := wam_ai.cfg();
  RETURN LEAST(GREATEST(COALESCE(p_limit, c.default_list_limit), 1), c.max_list_limit);
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.lead_ref(p_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT 'L-' || left(encode(extensions.digest(
    p_id::text || (SELECT opaque_ref_pepper FROM wam_ai.reporting_config WHERE id = 1), 'sha256'), 'hex'), 12);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.agent_business_id(p_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT 'A-' || upper(left(replace(p_id::text, '-', ''), 8));
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.offer_timeout_minutes()
RETURNS integer LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT COALESCE((SELECT offer_timeout_minutes FROM public.dispatch_config ORDER BY id LIMIT 1), 10);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.sla_hours()
RETURNS integer LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT COALESCE((SELECT sla_hours FROM public.dispatch_config ORDER BY id LIMIT 1), 24);
$fn$;

-- Latest non-null meaningful progress (GREATEST ignores nulls in PostgreSQL).
CREATE OR REPLACE FUNCTION wam_ai.assigned_progress_at(
  p_call timestamptz, p_kyc_started timestamptz, p_accepted timestamptz,
  p_updated timestamptz, p_created timestamptz
) RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT GREATEST(p_call, p_kyc_started, p_accepted, p_updated, p_created);
$fn$;

COMMENT ON FUNCTION wam_ai.assigned_progress_at IS
  'MAX of call_initiated_at, kyc_started_at, accepted_at, updated_at, created_at (nulls ignored).';

CREATE OR REPLACE FUNCTION wam_ai.verify_assigned_progress_cases()
RETURNS TABLE(case_id text, progress_at timestamptz, expected timestamptz, ok boolean)
LANGUAGE sql IMMUTABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT v.case_id, v.progress_at, v.expected, (v.progress_at = v.expected) AS ok
  FROM (VALUES
    ('newer_kyc_beats_older_call',
      wam_ai.assigned_progress_at('2026-08-01T10:00:00Z'::timestamptz,'2026-08-02T12:00:00Z'::timestamptz,NULL,NULL,'2026-08-01T09:00:00Z'::timestamptz),
      '2026-08-02T12:00:00Z'::timestamptz),
    ('newer_update_beats_older_call',
      wam_ai.assigned_progress_at('2026-08-01T10:00:00Z'::timestamptz,NULL,NULL,'2026-08-03T08:00:00Z'::timestamptz,'2026-08-01T09:00:00Z'::timestamptz),
      '2026-08-03T08:00:00Z'::timestamptz),
    ('all_null_except_created',
      wam_ai.assigned_progress_at(NULL,NULL,NULL,NULL,'2026-08-01T09:00:00Z'::timestamptz),
      '2026-08-01T09:00:00Z'::timestamptz)
  ) AS v(case_id, progress_at, expected);
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.has_valid_active_offer(p_lead_id uuid, p_timeout_minutes integer)
RETURNS boolean LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.lead_offers o
    WHERE o.lead_id = p_lead_id AND o.status = 'offered'
      AND (
        (o.expires_at IS NOT NULL AND o.expires_at > now())
        OR (o.expires_at IS NULL AND o.created_at >= now() - make_interval(mins => p_timeout_minutes))
      )
  );
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.latest_offer_row(p_lead_id uuid)
RETURNS TABLE(offer_id uuid, status text, created_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT o.id, o.status::text, o.created_at, o.expires_at
  FROM public.lead_offers o WHERE o.lead_id = p_lead_id
  ORDER BY o.created_at DESC NULLS LAST LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.stall_code_for_lead(
  p_status text,
  p_lead_id uuid,
  p_created_at timestamptz,
  p_call timestamptz, p_kyc_started timestamptz, p_accepted timestamptz,
  p_updated timestamptz, p_kyc_completed timestamptz, p_callback_at timestamptz,
  p_dispatch_backlog_hours integer, p_offer_timeout integer, p_sla integer,
  p_kyc_stalled_hours integer, p_installation_followup_hours integer,
  p_pending_install_review_hours integer
) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
BEGIN
  IF p_status IN ('pending_dispatch','admin_queue')
     AND p_created_at < now() - make_interval(hours => p_dispatch_backlog_hours) THEN
    RETURN 'DISPATCH_BACKLOG';
  END IF;
  IF p_status = 'offered' THEN
    IF wam_ai.has_valid_active_offer(p_lead_id, p_offer_timeout) THEN RETURN NULL; END IF;
    RETURN 'STUCK_OFFER';
  END IF;
  IF p_status = 'assigned'
     AND wam_ai.assigned_progress_at(p_call, p_kyc_started, p_accepted, p_updated, p_created_at)
         < now() - make_interval(hours => p_sla) THEN
    RETURN 'AGENT_FOLLOWUP_OVERDUE';
  END IF;
  IF p_status = 'kyc_in_progress'
     AND COALESCE(p_kyc_started, p_updated, p_created_at)
       < now() - make_interval(hours => p_kyc_stalled_hours) THEN
    RETURN 'KYC_STALLED';
  END IF;
  IF p_status = 'kyc_completed'
     AND COALESCE(p_kyc_completed, p_updated, p_created_at)
       < now() - make_interval(hours => p_installation_followup_hours) THEN
    RETURN 'INSTALLATION_FOLLOWUP_REQUIRED';
  END IF;
  IF p_status = 'pending_install'
     AND COALESCE(p_updated, p_created_at)
       < now() - make_interval(hours => p_pending_install_review_hours) THEN
    RETURN 'ADMIN_INSTALL_REVIEW_BACKLOG';
  END IF;
  IF p_status = 'deferred' AND p_callback_at IS NOT NULL AND p_callback_at < now() THEN
    RETURN 'DEFERRED_CALLBACK_OVERDUE';
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.stalled_leads_set()
RETURNS TABLE(
  lead_id uuid, stall_code text, status text, source text, product text,
  county text, town text, age_hours numeric,
  offer_created_at timestamptz, offer_expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT l.id,
    wam_ai.stall_code_for_lead(
      l.status::text, l.id, l.created_at,
      l.call_initiated_at, l.kyc_started_at, l.accepted_at, l.updated_at,
      l.kyc_completed_at, l.callback_at,
      (SELECT dispatch_backlog_hours FROM wam_ai.reporting_config WHERE id=1),
      COALESCE((SELECT offer_timeout_minutes FROM public.dispatch_config ORDER BY id LIMIT 1), 10),
      COALESCE((SELECT sla_hours FROM public.dispatch_config ORDER BY id LIMIT 1), 24),
      (SELECT kyc_stalled_hours FROM wam_ai.reporting_config WHERE id=1),
      (SELECT installation_followup_hours FROM wam_ai.reporting_config WHERE id=1),
      (SELECT pending_install_review_hours FROM wam_ai.reporting_config WHERE id=1)
    ),
    l.status::text, l.source::text, l.product::text, l.county, l.installation_town,
    round(EXTRACT(EPOCH FROM (now() - COALESCE(
      (SELECT lo.created_at FROM wam_ai.latest_offer_row(l.id) lo), l.created_at
    )))/3600.0, 1),
    (SELECT lo.created_at FROM wam_ai.latest_offer_row(l.id) lo),
    (SELECT lo.expires_at FROM wam_ai.latest_offer_row(l.id) lo)
  FROM public.inbound_leads l
  WHERE l.status IN (
    'pending_dispatch','admin_queue','offered','assigned',
    'kyc_in_progress','kyc_completed','pending_install','deferred');
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.stall_counts_exact()
RETURNS TABLE(stall_code text, cnt integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
  SELECT s.stall_code, count(*)::int FROM wam_ai.stalled_leads_set() s
  WHERE s.stall_code IS NOT NULL GROUP BY s.stall_code;
$fn$;

CREATE OR REPLACE FUNCTION wam_ai.record_audit_event(
  p_correlation_id uuid,
  p_actor_id text, p_actor_role text, p_session_or_channel_id text,
  p_operation_name text, p_tool_namespace text, p_param_hash text,
  p_param_redacted jsonb, p_data_classification text, p_result_count integer,
  p_outcome text, p_error_category text DEFAULT NULL, p_duration_ms integer DEFAULT NULL,
  p_instance_id text DEFAULT NULL, p_identity_verified boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'correlation_id_required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO wam_ai.audit_events (
    correlation_id, instance_id, actor_id, actor_role, identity_verified,
    session_or_channel_id, operation_name, tool_namespace,
    param_hash, param_redacted, data_classification, result_count, outcome,
    error_category, duration_ms
  ) VALUES (
    p_correlation_id,
    NULLIF(trim(p_instance_id), ''),
    COALESCE(NULLIF(trim(p_actor_id), ''), 'unknown'),
    COALESCE(NULLIF(trim(p_actor_role), ''), 'unknown'),
    COALESCE(p_identity_verified, false),
    p_session_or_channel_id, p_operation_name,
    COALESCE(NULLIF(trim(p_tool_namespace), ''), 'wam.business.analytics'),
    p_param_hash, p_param_redacted,
    COALESCE(NULLIF(trim(p_data_classification), ''), 'internal_operational'),
    p_result_count, p_outcome, p_error_category, p_duration_ms
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- Meaningful progress helpers installed above; remove unused marker if present
DROP FUNCTION IF EXISTS wam_ai._phase1a_helpers_marker();

CREATE OR REPLACE FUNCTION wam_ai.get_operational_summary(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_product text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE r record; v_product text := NULLIF(lower(trim(p_product)), ''); v jsonb;
  v_airtel_regs int; v_saf_regs int; v_airtel_inst int; v_saf_inst int;
  v_timeout integer := wam_ai.offer_timeout_minutes();
BEGIN
  IF v_product IS NOT NULL AND v_product NOT IN ('airtel','safaricom') THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM wam_ai.clamp_range(p_from, p_to);
  SELECT count(*)::int INTO v_airtel_regs FROM public.customer_registrations
    WHERE created_at >= r.range_from AND created_at <= r.range_to;
  SELECT count(*)::int INTO v_saf_regs FROM public.safaricom_registrations
    WHERE created_at >= r.range_from AND created_at <= r.range_to;
  SELECT count(*)::int INTO v_airtel_inst FROM public.customer_registrations
    WHERE status='installed' AND updated_at >= r.range_from AND updated_at <= r.range_to;
  SELECT count(*)::int INTO v_saf_inst FROM public.safaricom_registrations
    WHERE status='installed' AND updated_at >= r.range_from AND updated_at <= r.range_to;
  SELECT jsonb_build_object(
    'range_from', r.range_from, 'range_to', r.range_to, 'product_filter', v_product,
    'inbound_leads_created', (SELECT count(*)::int FROM public.inbound_leads l
      WHERE l.created_at >= r.range_from AND l.created_at <= r.range_to
        AND (v_product IS NULL OR l.product = v_product)),
    'inbound_status_counts', (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) FROM (
      SELECT status, count(*)::int AS cnt FROM public.inbound_leads l
      WHERE l.created_at >= r.range_from AND l.created_at <= r.range_to
        AND (v_product IS NULL OR l.product = v_product) GROUP BY status) s),
    'lead_offers_created', (SELECT count(*)::int FROM public.lead_offers o
      JOIN public.inbound_leads l ON l.id=o.lead_id
      WHERE o.created_at >= r.range_from AND o.created_at <= r.range_to
        AND (v_product IS NULL OR l.product = v_product)),
    'inbound_installed_in_range', (SELECT count(*)::int FROM public.inbound_leads l
      WHERE l.status='installed' AND COALESCE(l.installed_at,l.updated_at) >= r.range_from
        AND COALESCE(l.installed_at,l.updated_at) <= r.range_to
        AND (v_product IS NULL OR l.product = v_product)),
    'airtel_customer_registrations_created',
      CASE WHEN v_product IS NULL OR v_product='airtel' THEN v_airtel_regs ELSE NULL END,
    'safaricom_registrations_created',
      CASE WHEN v_product IS NULL OR v_product='safaricom' THEN v_saf_regs ELSE NULL END,
    'airtel_customer_registrations_installed_in_range',
      CASE WHEN v_product IS NULL OR v_product='airtel' THEN v_airtel_inst ELSE NULL END,
    'safaricom_registrations_installed_in_range',
      CASE WHEN v_product IS NULL OR v_product='safaricom' THEN v_saf_inst ELSE NULL END,
    'registration_installed_in_range_for_filter',
      CASE WHEN v_product='airtel' THEN v_airtel_inst
           WHEN v_product='safaricom' THEN v_saf_inst
           ELSE v_airtel_inst + v_saf_inst END,
    'platform_wide', jsonb_build_object(
      'active_agents_approved', (SELECT count(*)::int FROM public.agents WHERE status='approved'),
      'agents_dispatch_scope_none', (SELECT count(*)::int FROM public.agents
        WHERE status='approved' AND lead_dispatch_scope='none'),
      'deferred_open', (SELECT count(*)::int FROM public.inbound_leads WHERE status='deferred'),
      'pending_install_open', (SELECT count(*)::int FROM public.inbound_leads WHERE status='pending_install'),
      'open_assignment_attention', (SELECT count(*)::int FROM public.inbound_leads l
        WHERE l.status IN ('pending_dispatch','admin_queue','needs_reassignment')
           OR (l.status='offered' AND NOT wam_ai.has_valid_active_offer(l.id, v_timeout)))
    ),
    'field_labels', jsonb_build_object(
      'product_filtered', ARRAY[
        'inbound_leads_created','inbound_status_counts','lead_offers_created',
        'inbound_installed_in_range','registration_installed_in_range_for_filter',
        'airtel_customer_registrations_*','safaricom_registrations_*'],
      'platform_wide', ARRAY['platform_wide.*']
    )
  ) INTO v; RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_agent_performance_summary(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_limit integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE r record; v_limit integer := wam_ai.clamp_limit(p_limit); v jsonb;
BEGIN
  SELECT * INTO r FROM wam_ai.clamp_range(p_from, p_to);
  SELECT jsonb_build_object('range_from', r.range_from, 'range_to', r.range_to, 'limit', v_limit,
    'agents', COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)) INTO v
  FROM (
    SELECT wam_ai.agent_business_id(a.id) AS agent_business_id,
      COALESCE(NULLIF(trim(a.name),''),'Unnamed agent') AS agent_display_name,
      a.status AS agent_status, a.lead_dispatch_scope,
      (SELECT count(*)::int FROM public.lead_offers o WHERE o.agent_id=a.id AND o.status='accepted'
        AND o.responded_at >= r.range_from AND o.responded_at <= r.range_to) AS offers_accepted,
      (SELECT count(*)::int FROM public.inbound_leads l WHERE l.assigned_agent_id=a.id AND l.status='installed'
        AND COALESCE(l.installed_at,l.updated_at) >= r.range_from
        AND COALESCE(l.installed_at,l.updated_at) <= r.range_to) AS inbound_installs,
      (SELECT count(*)::int FROM public.customer_registrations cr WHERE cr.agent_id=a.id AND cr.status='installed'
        AND cr.updated_at >= r.range_from AND cr.updated_at <= r.range_to)
      + (SELECT count(*)::int FROM public.safaricom_registrations sr WHERE sr.agent_id=a.id AND sr.status='installed'
        AND sr.updated_at >= r.range_from AND sr.updated_at <= r.range_to) AS registrations_installed,
      (SELECT COALESCE(sum(l.commission_earned_ksh),0)::numeric FROM public.inbound_leads l
        WHERE l.assigned_agent_id=a.id AND l.status='installed'
          AND COALESCE(l.installed_at,l.updated_at) >= r.range_from
          AND COALESCE(l.installed_at,l.updated_at) <= r.range_to) AS inbound_install_commission_earned_ksh,
      (SELECT COALESCE(sum(p.amount_ksh),0)::numeric FROM public.agent_payments p
        WHERE p.agent_id=a.id AND p.created_at >= r.range_from AND p.created_at <= r.range_to) AS payments_paid_ksh,
      (SELECT count(*)::int FROM public.inbound_leads l WHERE l.assigned_agent_id=a.id
        AND l.status IN ('assigned','kyc_in_progress','kyc_completed','pending_install')) AS open_active_leads
    FROM public.agents a WHERE a.status='approved'
    ORDER BY inbound_installs DESC, registrations_installed DESC, offers_accepted DESC
    LIMIT v_limit
  ) t; RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_inbound_lead_funnel(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_source text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE r record; v_source text := NULLIF(lower(trim(p_source)),''); v jsonb;
BEGIN
  IF v_source IS NOT NULL AND v_source NOT IN ('airtel5grouter','internetkenya','agent_own') THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM wam_ai.clamp_range(p_from, p_to);
  SELECT jsonb_build_object(
    'range_from', r.range_from, 'range_to', r.range_to, 'source_filter', v_source,
    'created_in_range_by_status', (SELECT COALESCE(jsonb_object_agg(status,cnt),'{}'::jsonb) FROM (
      SELECT status, count(*)::int cnt FROM public.inbound_leads l
      WHERE l.created_at >= r.range_from AND l.created_at <= r.range_to
        AND (v_source IS NULL OR l.source=v_source) GROUP BY status) s),
    'open_snapshot_by_status', (SELECT COALESCE(jsonb_object_agg(status,cnt),'{}'::jsonb) FROM (
      SELECT status, count(*)::int cnt FROM public.inbound_leads l
      WHERE l.status NOT IN ('installed','lost','expired','cancelled','rejected','duplicate')
        AND (v_source IS NULL OR l.source=v_source) GROUP BY status) s),
    'offers_in_range_by_status', (SELECT COALESCE(jsonb_object_agg(status,cnt),'{}'::jsonb) FROM (
      SELECT o.status, count(*)::int cnt FROM public.lead_offers o
      JOIN public.inbound_leads l ON l.id=o.lead_id
      WHERE o.created_at >= r.range_from AND o.created_at <= r.range_to
        AND (v_source IS NULL OR l.source=v_source) GROUP BY o.status) s)
  ) INTO v; RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_unassigned_leads(
  p_limit integer DEFAULT NULL, p_product text DEFAULT NULL, p_county text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE v_limit integer := wam_ai.clamp_limit(p_limit);
  v_product text := NULLIF(lower(trim(p_product)),'');
  v_county text := NULLIF(trim(p_county),'');
  v_timeout integer := wam_ai.offer_timeout_minutes();
  v jsonb; v_count integer;
BEGIN
  IF v_product IS NOT NULL AND v_product NOT IN ('airtel','safaricom') THEN
    RAISE EXCEPTION 'unsupported_filter' USING ERRCODE='22023'; END IF;
  SELECT count(*)::int INTO v_count FROM public.inbound_leads l
  WHERE (l.status IN ('pending_dispatch','admin_queue','needs_reassignment')
    OR (l.status='offered' AND NOT wam_ai.has_valid_active_offer(l.id, v_timeout)))
    AND (v_product IS NULL OR l.product=v_product)
    AND (v_county IS NULL OR l.county ILIKE v_county);
  SELECT jsonb_build_object(
    'definition','assignment_attention',
    'includes_statuses', jsonb_build_array('pending_dispatch','admin_queue','needs_reassignment','offered_without_valid_active_offer'),
    'excludes', jsonb_build_array('deferred'),
    'deferred_open_count', (SELECT count(*)::int FROM public.inbound_leads WHERE status='deferred'),
    'limit', v_limit, 'result_count', v_count,
    'leads', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
      SELECT wam_ai.lead_ref(l.id) AS lead_ref, l.status, l.source, l.product, l.county,
        l.installation_town AS town,
        round(EXTRACT(EPOCH FROM (now()-l.created_at))/3600.0,1) AS age_hours,
        CASE WHEN l.status='offered' THEN 'offered_without_valid_active_offer' ELSE l.status END AS attention_reason
      FROM public.inbound_leads l
      WHERE (l.status IN ('pending_dispatch','admin_queue','needs_reassignment')
        OR (l.status='offered' AND NOT wam_ai.has_valid_active_offer(l.id, v_timeout)))
        AND (v_product IS NULL OR l.product=v_product)
        AND (v_county IS NULL OR l.county ILIKE v_county)
      ORDER BY l.created_at ASC LIMIT v_limit
    ) t), '[]'::jsonb)
  ) INTO v; RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_overdue_or_stalled_leads(p_limit integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE c wam_ai.reporting_config := wam_ai.cfg();
  v_limit integer := wam_ai.clamp_limit(p_limit);
  v_offer_timeout integer := wam_ai.offer_timeout_minutes();
  v_sla integer := wam_ai.sla_hours();
  v_total integer;
  v jsonb;
BEGIN
  SELECT count(*)::int INTO v_total FROM wam_ai.stalled_leads_set() s WHERE s.stall_code IS NOT NULL;
  SELECT jsonb_build_object(
    'thresholds', jsonb_build_object(
      'dispatch_backlog_hours', c.dispatch_backlog_hours,
      'offer_timeout_minutes', v_offer_timeout,
      'sla_hours', v_sla,
      'kyc_stalled_hours', c.kyc_stalled_hours,
      'installation_followup_hours', c.installation_followup_hours,
      'pending_install_review_hours', c.pending_install_review_hours,
      'assigned_progress_proxy',
        'GREATEST(call_initiated_at, kyc_started_at, accepted_at, updated_at, created_at) nulls ignored',
      'stuck_offer_rule',
        'lead.status=offered AND NOT has_valid_active_offer (offer expires_at/created_at+timeout); lead.created_at unused'
    ),
    'limit', v_limit,
    'total_stalled_count', v_total,
    'counts_by_stall_code', (SELECT COALESCE(jsonb_object_agg(stall_code, cnt), '{}'::jsonb)
      FROM wam_ai.stall_counts_exact()),
    'leads', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
      SELECT wam_ai.lead_ref(s.lead_id) AS lead_ref, s.status, s.source, s.product, s.county,
        s.town, s.stall_code, s.age_hours, s.offer_created_at, s.offer_expires_at
      FROM wam_ai.stalled_leads_set() s
      WHERE s.stall_code IS NOT NULL
      ORDER BY s.age_hours DESC NULLS LAST
      LIMIT v_limit
    ) t), '[]'::jsonb)
  ) INTO v; RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_registration_install_trends(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_grain text DEFAULT 'day'
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE r record; v_grain text := lower(COALESCE(NULLIF(trim(p_grain),''),'day')); v jsonb;
  v_step interval;
BEGIN
  IF v_grain NOT IN ('day','week') THEN RAISE EXCEPTION 'unsupported_filter' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM wam_ai.clamp_range(p_from, p_to);
  v_step := CASE WHEN v_grain='week' THEN interval '1 week' ELSE interval '1 day' END;
  SELECT jsonb_build_object('range_from', r.range_from, 'range_to', r.range_to, 'grain', v_grain,
    'series', COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.bucket_start), '[]'::jsonb)) INTO v
  FROM (
    SELECT
      d.bucket AS bucket_start,
      GREATEST(d.bucket, r.range_from) AS window_from,
      LEAST(d.bucket + v_step - interval '1 microsecond', r.range_to) AS window_to,
      (SELECT count(*)::int FROM public.customer_registrations
        WHERE created_at >= GREATEST(d.bucket, r.range_from)
          AND created_at <= LEAST(d.bucket + v_step - interval '1 microsecond', r.range_to)) AS customer_regs_created,
      (SELECT count(*)::int FROM public.customer_registrations
        WHERE status='installed'
          AND updated_at >= GREATEST(d.bucket, r.range_from)
          AND updated_at <= LEAST(d.bucket + v_step - interval '1 microsecond', r.range_to)) AS customer_regs_installed_touch,
      (SELECT count(*)::int FROM public.safaricom_registrations
        WHERE created_at >= GREATEST(d.bucket, r.range_from)
          AND created_at <= LEAST(d.bucket + v_step - interval '1 microsecond', r.range_to)) AS safaricom_regs_created,
      (SELECT count(*)::int FROM public.inbound_leads
        WHERE created_at >= GREATEST(d.bucket, r.range_from)
          AND created_at <= LEAST(d.bucket + v_step - interval '1 microsecond', r.range_to)) AS inbound_created,
      (SELECT count(*)::int FROM public.inbound_leads
        WHERE status='installed'
          AND COALESCE(installed_at,updated_at) >= GREATEST(d.bucket, r.range_from)
          AND COALESCE(installed_at,updated_at) <= LEAST(d.bucket + v_step - interval '1 microsecond', r.range_to)
      ) AS inbound_installed_touch,
      (SELECT count(*)::int FROM public.inbound_leads
        WHERE status='pending_install'
          AND updated_at >= GREATEST(d.bucket, r.range_from)
          AND updated_at <= LEAST(d.bucket + v_step - interval '1 microsecond', r.range_to)
      ) AS inbound_pending_install_touch
    FROM generate_series(
      date_trunc(v_grain, r.range_from),
      date_trunc(v_grain, r.range_to),
      v_step
    ) AS d(bucket)
    WHERE GREATEST(d.bucket, r.range_from)
        <= LEAST(d.bucket + v_step - interval '1 microsecond', r.range_to)
  ) t; RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_county_location_demand(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_limit integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE r record; v_limit integer := wam_ai.clamp_limit(p_limit); v jsonb;
BEGIN
  SELECT * INTO r FROM wam_ai.clamp_range(p_from, p_to);
  SELECT jsonb_build_object('range_from', r.range_from, 'range_to', r.range_to, 'limit', v_limit,
    'counties', COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)) INTO v
  FROM (
    SELECT COALESCE(NULLIF(trim(l.county),''),'Unknown') AS county,
      count(*)::int AS lead_count,
      count(*) FILTER (WHERE l.status='installed')::int AS installed_count,
      count(*) FILTER (WHERE l.status='pending_install')::int AS pending_install_count
    FROM public.inbound_leads l
    WHERE l.created_at >= r.range_from AND l.created_at <= r.range_to
    GROUP BY 1 ORDER BY lead_count DESC LIMIT v_limit
  ) t; RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_commission_payment_summary(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE r record; v jsonb;
BEGIN
  SELECT * INTO r FROM wam_ai.clamp_range(p_from, p_to);
  SELECT jsonb_build_object(
    'range_from', r.range_from, 'range_to', r.range_to,
    'terminology', jsonb_build_object(
      'commission_earned', 'Inbound installed commission_earned_ksh accrued in-range; registration package commissions not fully reimplemented in SQL',
      'payment_made', 'Sum of agent_payments.amount_ksh ledger rows in-range (no payment status column)',
      'outstanding_balance', 'unavailable_in_phase_1a'
    ),
    'inbound_install_commission_earned_ksh', (
      SELECT COALESCE(sum(commission_earned_ksh),0)::numeric FROM public.inbound_leads
      WHERE status='installed' AND COALESCE(installed_at,updated_at) >= r.range_from
        AND COALESCE(installed_at,updated_at) <= r.range_to),
    'inbound_installs_confirmed', (
      SELECT count(*)::int FROM public.inbound_leads WHERE status='installed'
        AND COALESCE(installed_at,updated_at) >= r.range_from
        AND COALESCE(installed_at,updated_at) <= r.range_to),
    'customer_registrations_installed', (
      SELECT count(*)::int FROM public.customer_registrations WHERE status='installed'
        AND updated_at >= r.range_from AND updated_at <= r.range_to),
    'safaricom_registrations_installed', (
      SELECT count(*)::int FROM public.safaricom_registrations WHERE status='installed'
        AND updated_at >= r.range_from AND updated_at <= r.range_to),
    'payments_paid_ksh', (
      SELECT COALESCE(sum(amount_ksh),0)::numeric FROM public.agent_payments
      WHERE created_at >= r.range_from AND created_at <= r.range_to),
    'payment_ledger_rows', (
      SELECT count(*)::int FROM public.agent_payments
      WHERE created_at >= r.range_from AND created_at <= r.range_to),
    'outstanding_balance_kes', NULL,
    'outstanding_balance_status', 'unavailable',
    'outstanding_balance_reason',
      'Full agent wallet (package rates + inbound install − ledger) lives in admin-dashboard/lib/agent-wallet.ts; Phase 1A does not duplicate it.',
    'top_agents_by_inbound_install_commission', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
      SELECT wam_ai.agent_business_id(a.id) AS agent_business_id,
        COALESCE(NULLIF(trim(a.name),''),'Unnamed agent') AS agent_display_name,
        COALESCE(sum(l.commission_earned_ksh),0)::numeric AS inbound_install_commission_earned_ksh,
        count(*)::int AS inbound_installs
      FROM public.inbound_leads l JOIN public.agents a ON a.id=l.assigned_agent_id
      WHERE l.status='installed' AND COALESCE(l.installed_at,l.updated_at) >= r.range_from
        AND COALESCE(l.installed_at,l.updated_at) <= r.range_to
      GROUP BY a.id, a.name ORDER BY 3 DESC LIMIT 15
    ) t), '[]'::jsonb)
  ) INTO v; RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION wam_ai.find_likely_duplicates_or_incomplete(
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_limit integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE r record; v_limit integer := wam_ai.clamp_limit(p_limit); v jsonb;
BEGIN
  SELECT * INTO r FROM wam_ai.clamp_range(p_from, p_to);
  SELECT jsonb_build_object(
    'range_from', r.range_from, 'range_to', r.range_to, 'limit', v_limit,
    'duplicate_groups', COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM (
      SELECT 'DG-' || left(encode(extensions.digest(d.dedupe_phone_key,'sha256'),'hex'),12) AS group_ref,
        'phone_hash_match' AS match_reason_code, count(*)::int AS member_count,
        jsonb_agg(wam_ai.lead_ref(d.id) ORDER BY d.created_at) AS lead_refs
      FROM public.inbound_leads d
      WHERE d.created_at >= r.range_from AND d.created_at <= r.range_to AND d.dedupe_phone_key IS NOT NULL
      GROUP BY d.dedupe_phone_key HAVING count(*) > 1
      ORDER BY count(*) DESC LIMIT v_limit
    ) g), '[]'::jsonb),
    'incomplete_leads', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM (
      SELECT wam_ai.lead_ref(l.id) AS lead_ref, l.status, l.product, l.county,
        CASE
          WHEN l.county IS NULL OR btrim(l.county)='' THEN 'missing_county'
          WHEN l.installation_town IS NULL OR btrim(l.installation_town)='' THEN 'missing_town'
          WHEN l.assigned_agent_id IS NULL AND l.status IN ('assigned','kyc_in_progress','kyc_completed','pending_install','installed')
            THEN 'missing_assigned_agent'
          ELSE 'incomplete_fields'
        END AS incomplete_reason
      FROM public.inbound_leads l
      WHERE l.created_at >= r.range_from AND l.created_at <= r.range_to
        AND (l.county IS NULL OR btrim(l.county)='' OR l.installation_town IS NULL OR btrim(l.installation_town)=''
          OR (l.assigned_agent_id IS NULL AND l.status IN ('assigned','kyc_in_progress','kyc_completed','pending_install','installed')))
      ORDER BY l.created_at DESC LIMIT v_limit
    ) i), '[]'::jsonb)
  ) INTO v; RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION wam_ai.get_operational_exceptions(p_limit integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wam_ai, extensions, pg_catalog, pg_temp AS $fn$
DECLARE v_limit integer := wam_ai.clamp_limit(p_limit); v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'limit', v_limit,
    'counts_are_exact', true,
    'display_list_limited', true,
    'exceptions', COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
  ) INTO v
  FROM (
    SELECT * FROM (
      SELECT 'ASSIGNMENT_ATTENTION'::text AS exception_code, 'high'::text AS severity,
        (wam_ai.get_unassigned_leads(1)->>'result_count')::int AS cnt,
        'Leads needing assignment attention (excludes deferred)'::text AS hint
      UNION ALL SELECT 'DEFERRED_OPEN','medium',
        (SELECT count(*)::int FROM public.inbound_leads WHERE status='deferred'),
        'Deferred leads parked for callback (not unassigned)'
      UNION ALL SELECT 'PENDING_INSTALL_BACKLOG','high',
        (SELECT count(*)::int FROM public.inbound_leads WHERE status='pending_install'),
        'Installs awaiting admin confirmation'
      UNION ALL SELECT 'AGENTS_SCOPE_NONE','medium',
        (SELECT count(*)::int FROM public.agents WHERE status='approved' AND lead_dispatch_scope='none'),
        'Approved agents not in dispatch scope'
      UNION ALL SELECT 'STALL_DISPATCH_BACKLOG','high',
        COALESCE((SELECT cnt FROM wam_ai.stall_counts_exact() WHERE stall_code='DISPATCH_BACKLOG'), 0),
        'Dispatch backlog stalls'
      UNION ALL SELECT 'STALL_STUCK_OFFER','high',
        COALESCE((SELECT cnt FROM wam_ai.stall_counts_exact() WHERE stall_code='STUCK_OFFER'), 0),
        'Stuck offers (no valid active offer)'
      UNION ALL SELECT 'STALL_AGENT_FOLLOWUP_OVERDUE','high',
        COALESCE((SELECT cnt FROM wam_ai.stall_counts_exact() WHERE stall_code='AGENT_FOLLOWUP_OVERDUE'), 0),
        'Assigned without progress beyond SLA'
      UNION ALL SELECT 'STALL_KYC_STALLED','medium',
        COALESCE((SELECT cnt FROM wam_ai.stall_counts_exact() WHERE stall_code='KYC_STALLED'), 0),
        'KYC in progress too long'
      UNION ALL SELECT 'STALL_INSTALLATION_FOLLOWUP_REQUIRED','medium',
        COALESCE((SELECT cnt FROM wam_ai.stall_counts_exact() WHERE stall_code='INSTALLATION_FOLLOWUP_REQUIRED'), 0),
        'KYC done without install progress'
      UNION ALL SELECT 'STALL_ADMIN_INSTALL_REVIEW_BACKLOG','high',
        COALESCE((SELECT cnt FROM wam_ai.stall_counts_exact() WHERE stall_code='ADMIN_INSTALL_REVIEW_BACKLOG'), 0),
        'Pending install review overdue'
      UNION ALL SELECT 'STALL_DEFERRED_CALLBACK_OVERDUE','medium',
        COALESCE((SELECT cnt FROM wam_ai.stall_counts_exact() WHERE stall_code='DEFERRED_CALLBACK_OVERDUE'), 0),
        'Deferred callback time passed'
    ) raw WHERE raw.cnt > 0
    ORDER BY CASE raw.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, raw.cnt DESC
    LIMIT v_limit
  ) e; RETURN v;
END; $fn$;

REVOKE ALL ON SCHEMA wam_ai FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA wam_ai FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wam_ai FROM PUBLIC;

-- Prevent future wam_ai functions from defaulting to PUBLIC EXECUTE
ALTER DEFAULT PRIVILEGES IN SCHEMA wam_ai
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA wam_ai
  REVOKE ALL ON TABLES FROM PUBLIC;

COMMENT ON FUNCTION wam_ai.get_operational_summary IS 'MCP: wam.business.analytics.get_operational_summary';
COMMENT ON FUNCTION wam_ai.get_agent_performance_summary IS 'MCP: wam.business.analytics.get_agent_performance_summary';
COMMENT ON FUNCTION wam_ai.get_inbound_lead_funnel IS 'MCP: wam.business.analytics.get_inbound_lead_funnel';
COMMENT ON FUNCTION wam_ai.get_unassigned_leads IS 'MCP: wam.business.analytics.get_unassigned_leads';
COMMENT ON FUNCTION wam_ai.get_overdue_or_stalled_leads IS 'MCP: wam.business.analytics.get_overdue_or_stalled_leads';
COMMENT ON FUNCTION wam_ai.get_registration_install_trends IS 'MCP: wam.business.analytics.get_registration_install_trends';
COMMENT ON FUNCTION wam_ai.get_county_location_demand IS 'MCP: wam.business.analytics.get_county_location_demand';
COMMENT ON FUNCTION wam_ai.get_commission_payment_summary IS 'MCP: wam.business.analytics.get_commission_payment_summary';
COMMENT ON FUNCTION wam_ai.find_likely_duplicates_or_incomplete IS 'MCP: wam.business.analytics.find_likely_duplicates_or_incomplete';
COMMENT ON FUNCTION wam_ai.get_operational_exceptions IS 'MCP: wam.business.analytics.get_operational_exceptions';

-- Future role grants (NOT executed as CREATE ROLE here):
-- CREATE ROLE wam_ai_business_readonly LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- GRANT USAGE ON SCHEMA wam_ai TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_operational_summary(timestamptz,timestamptz,text) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_agent_performance_summary(timestamptz,timestamptz,integer) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_inbound_lead_funnel(timestamptz,timestamptz,text) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_unassigned_leads(integer,text,text) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_overdue_or_stalled_leads(integer) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_registration_install_trends(timestamptz,timestamptz,text) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_county_location_demand(timestamptz,timestamptz,integer) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_commission_payment_summary(timestamptz,timestamptz) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.find_likely_duplicates_or_incomplete(timestamptz,timestamptz,integer) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.get_operational_exceptions(integer) TO wam_ai_business_readonly;
-- GRANT EXECUTE ON FUNCTION wam_ai.record_audit_event(uuid,text,text,text,text,text,text,jsonb,text,integer,text,text,integer,text,boolean) TO wam_ai_business_readonly;
-- Do NOT GRANT SELECT on public.* or wam_ai.audit_events base table if using record_audit_event only.
