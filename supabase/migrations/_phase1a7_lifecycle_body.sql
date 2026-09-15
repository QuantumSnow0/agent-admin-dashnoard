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
