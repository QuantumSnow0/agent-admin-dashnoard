# WAM AI Phase 1A — privilege gate (run as privileged operator AFTER role creation)
# Refuse go-live if any row returns true for "forbidden".
# Does not print passwords. Does not mutate data beyond SELECT privilege checks.

-- 1) Role flags
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname = 'wam_ai_business_readonly';
-- Expect: rolsuper=false, rolbypassrls=false, rolcanlogin=true

-- 2) Must NOT execute payment mutation
SELECT has_function_privilege(
  'wam_ai_business_readonly',
  'public.admin_reverse_agent_payment(uuid)',
  'EXECUTE'
) AS can_reverse_payment;
-- Expect: false

-- 3) Enumerate ALL public-schema functions still executable by the role
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND has_function_privilege('wam_ai_business_readonly', p.oid, 'EXECUTE')
ORDER BY 1,2;
-- Expect: empty, or only explicitly approved non-mutating helpers after review

-- 4) Must NOT select operational base tables
SELECT
  has_table_privilege('wam_ai_business_readonly','public.inbound_leads','SELECT') AS sel_inbound,
  has_table_privilege('wam_ai_business_readonly','public.agents','SELECT') AS sel_agents,
  has_table_privilege('wam_ai_business_readonly','public.agent_payments','SELECT') AS sel_payments,
  has_table_privilege('wam_ai_business_readonly','public.device_tokens','SELECT') AS sel_tokens,
  has_table_privilege('wam_ai_business_readonly','wam_ai.audit_events','SELECT') AS sel_audit_table;
-- Expect: all false

-- 5) Must NOT write tables
SELECT
  has_table_privilege('wam_ai_business_readonly','public.inbound_leads','INSERT') AS ins,
  has_table_privilege('wam_ai_business_readonly','public.inbound_leads','UPDATE') AS upd,
  has_table_privilege('wam_ai_business_readonly','public.inbound_leads','DELETE') AS del;
-- Expect: all false

-- 6) Must execute only approved wam_ai RPCs
SELECT has_function_privilege(
  'wam_ai_business_readonly',
  'wam_ai.get_operational_summary(timestamptz,timestamptz,text)',
  'EXECUTE'
) AS can_ops_summary;
-- Expect: true

-- 7) Auth admin / secrets schemas (expect false / no access)
SELECT
  has_schema_privilege('wam_ai_business_readonly','auth','USAGE') AS auth_usage,
  has_schema_privilege('wam_ai_business_readonly','vault','USAGE') AS vault_usage;

-- 8) record_audit_event signature (MCP passes 15 args; confirm EXECUTE on this overload)
-- Signature:
--   wam_ai.record_audit_event(
--     p_correlation_id uuid,
--     p_actor_id text, p_actor_role text, p_session_or_channel_id text,
--     p_operation_name text, p_tool_namespace text, p_param_hash text,
--     p_param_redacted jsonb, p_data_classification text, p_result_count integer,
--     p_outcome text, p_error_category text, p_duration_ms integer,
--     p_instance_id text, p_identity_verified boolean
--   ) RETURNS uuid
SELECT has_function_privilege(
  'wam_ai_business_readonly',
  'wam_ai.record_audit_event(uuid,text,text,text,text,text,text,jsonb,text,integer,text,text,integer,text,boolean)',
  'EXECUTE'
) AS can_record_audit;
-- Expect: true after runbook GRANT
-- Note: MCP never accepts correlation_id / actor / identity from tool arguments.
