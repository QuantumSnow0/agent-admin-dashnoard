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
