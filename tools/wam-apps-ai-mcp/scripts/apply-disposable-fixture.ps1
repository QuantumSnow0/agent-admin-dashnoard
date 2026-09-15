# Disposable PostgreSQL fixture apply (Windows / cross-platform helper)
# Usage: .\scripts\apply-disposable-fixture.ps1 [database_url]
param(
  [string]$DatabaseUrl = "postgresql://postgres@localhost:5432/postgres"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $Root "..\..\..")

$psql = $env:PSQL
if (-not $psql) {
  $candidates = @(
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "psql"
  )
  foreach ($c in $candidates) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { $psql = $c; break }
    if (Test-Path $c) { $psql = $c; break }
  }
}
if (-not $psql) { throw "psql not found; set PSQL env var or install PostgreSQL 16+" }

function Invoke-PsqlFile {
  param([string]$File, [switch]$SingleTransaction)
  $args = @($DatabaseUrl, "-v", "ON_ERROR_STOP=1")
  if ($SingleTransaction) { $args += "--single-transaction" }
  $args += "-f", $File
  & $psql @args
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $File" }
}

Write-Host "Applying disposable stubs..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-stubs.sql")

Write-Host "Resetting mutable fixture rows..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-fixture-reset.sql")

$migrations = @(
  "20260827190000_wam_ai_phase1a_reporting.sql",
  "20260827191500_wam_ai_phase1a_public_privilege_hardening.sql",
  "20260828120000_wam_ai_phase1a1_open_book_reporting.sql",
  "20260828140000_wam_ai_phase1a1_agent_registration_performance.sql",
  "20260828160000_wam_ai_phase1a2_lead_agent_recommendations.sql",
  "20260828180000_wam_ai_phase1a2b_action_infrastructure.sql",
  "20260828181000_wam_ai_phase1a2b_create_lead_offer.sql",
  "20260828190000_wam_ai_phase1a3_action_infrastructure.sql",
  "20260828191000_wam_ai_phase1a3_agent_actions.sql",
  "20260828192000_wam_ai_phase1a3_registration_actions.sql",
  "20260828193000_wam_ai_phase1a3_lead_actions.sql",
  "20260828200000_wam_ai_phase1a4_notification_infrastructure.sql",
  "20260828201000_wam_ai_phase1a4_send_agent_notification.sql",
  "20260828202000_wam_ai_phase1a4_notification_read.sql",
  "20260828210000_wam_ai_phase1a5_infrastructure.sql",
  "20260828211000_wam_ai_phase1a5_lead_pipeline_actions.sql",
  "20260828212000_wam_ai_phase1a5_dispatch_ops_actions.sql",
  "20260828213000_wam_ai_phase1a5_agent_config_actions.sql",
  "20260828214000_wam_ai_phase1a5_registration_reopen_actions.sql",
  "20260828215000_wam_ai_phase1a5_financial_hardening.sql",
  "20260828220000_wam_ai_phase1a4_agent_reference_hotfix.sql",
  "20260828230000_wam_ai_phase1a6_sms_infrastructure.sql",
  "20260828231000_wam_ai_phase1a6_sms_actions.sql",
  "20260828232000_wam_ai_phase1a6_finalize_reservation_binding.sql",
  "20260828240000_wam_ai_phase1a7_intelligence_infrastructure.sql",
  "20260828241000_wam_ai_phase1a7_reconcile_remediation.sql",
  "20260829120000_wam_ai_phase1a8_reconcile_sessions.sql",
  "20260829121000_wam_ai_phase1a8_reconcile_cap_guc.sql",
  "20260829130000_wam_ai_phase1a8_session_security_remediation.sql",
  "20260910120000_wam_ai_phase1a9_semantic_query.sql",
  "20260912120000_wam_ai_phase1a9_visit_date_dual_format.sql",
  "20260912180000_wam_ai_business_partner_ops_authorization.sql"
)
foreach ($m in $migrations) {
  $path = Join-Path $RepoRoot "admin-dashboard\supabase\migrations\$m"
  Write-Host "Applying $m..."
  if ($m -like "*phase1a2*" -or $m -like "*phase1a3*" -or $m -like "*phase1a4*" -or $m -like "*phase1a5*" -or $m -like "*phase1a6*" -or $m -like "*phase1a7*" -or $m -like "*phase1a8*" -or $m -like "*phase1a9*" -or $m -like "*business_partner_ops*") {
    Invoke-PsqlFile $path -SingleTransaction
  } else {
    Invoke-PsqlFile $path
  }
}

Write-Host "Creating restricted roles and explicit function grants..."
$grantSql = @'
DO $r$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    CREATE ROLE wam_ai_business_readonly LOGIN PASSWORD 'fixture_only' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    CREATE ROLE wam_ai_business_actions LOGIN PASSWORD 'fixture_action_only' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE CONNECTION LIMIT 3;
  END IF;
END;
$r$;
GRANT USAGE ON SCHEMA wam_ai TO wam_ai_business_readonly;
GRANT USAGE ON SCHEMA wam_ai TO wam_ai_business_actions;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA wam_ai FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA wam_ai FROM wam_ai_business_readonly;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA wam_ai FROM wam_ai_business_actions;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM wam_ai_business_readonly;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.get_operational_summary(timestamptz,timestamptz,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.search_agents(text,text,text,text,text,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_agent_details(uuid,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.search_customers(text,text,text,text,text,text,uuid,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_customer_details(text,uuid,text,text,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.search_leads(text,text,text,text,text,text,text,uuid,text,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_lead_details(uuid,text,text,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_agent_registration_performance(timestamptz,timestamptz,text,uuid,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.recommend_agents_for_lead(uuid,text,integer,boolean,boolean,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.record_audit_event(uuid,text,text,text,text,text,text,jsonb,text,integer,text,text,integer,text,boolean) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.create_lead_offer(uuid,text,uuid,text,uuid,uuid,text,text,text,uuid,text,boolean,double precision,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.approve_agent(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.reject_agent(uuid,text,uuid,uuid,text,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.ban_agent(uuid,text,uuid,uuid,text,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.restore_agent(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.change_agent_dispatch_scope(uuid,text,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.reject_airtel_registration(uuid,text,uuid,uuid,text,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_airtel_registration_duplicate(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.cancel_airtel_registration(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.confirm_airtel_registration_installation(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.reject_safaricom_registration(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_safaricom_registration_duplicate(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.cancel_safaricom_registration(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.confirm_safaricom_registration_installation(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.confirm_lead_installation(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_lead_rejected(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_lead_duplicate(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_lead_cancelled(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_lead_lost(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_lead_needs_reassignment(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.revert_lead_pending_install(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.send_agent_notification(uuid,text,text,text,text,text,uuid,uuid,text,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_lead_kyc_completed(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.mark_lead_pending_install(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.expire_lead_offer(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.set_agent_pending(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.set_agent_fallback_dispatch(uuid,text,boolean,integer,uuid,uuid,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.set_agent_service_radius(uuid,text,double precision,boolean,uuid,uuid,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.reopen_airtel_registration_pending(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.reopen_safaricom_registration_pending(uuid,text,uuid,uuid,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.get_agent_notification_history(uuid,text,timestamptz,timestamptz,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_notification_delivery_status(text,uuid,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.prepare_send_agent_sms(uuid,text,text,text,uuid,uuid,text,text,text,text,text,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.finalize_send_agent_sms(uuid,uuid,text,text,text,text,text,text,boolean,text) TO wam_ai_business_actions;
GRANT EXECUTE ON FUNCTION wam_ai.preview_agent_sms_recipient(uuid,text,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_agent_sms_history(uuid,text,timestamptz,timestamptz,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_sms_delivery_status(text,uuid,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_agent_lifecycle(uuid,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.get_notification_capability_catalogue() TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.begin_reconcile_session(text,text,text,text,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.append_reconcile_session_rows(text,jsonb,text,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.finalize_reconcile_session(text,text,text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.cleanup_own_reconcile_sessions(text,text,integer) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.describe_business_query_catalogue(text) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.list_business_records(jsonb) TO wam_ai_business_readonly;
GRANT EXECUTE ON FUNCTION wam_ai.aggregate_business_metrics(jsonb) TO wam_ai_business_readonly;
-- cleanup_expired_reconcile_sessions is privileged ops-only (not granted to readonly).
-- Private _reconcile_* / _query_* helpers are intentionally not granted to login roles.
'@
$grantFile = Join-Path $env:TEMP "wam_ai_fixture_grants.sql"
Set-Content -Path $grantFile -Value $grantSql -Encoding UTF8
Invoke-PsqlFile $grantFile

Write-Host "Running privilege gates..."
Invoke-PsqlFile (Join-Path $Root "scripts\privilege-gate.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\action-privilege-gate.sql")

Write-Host "Running Phase 1A.3 disposable verification..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a3.sql")

Write-Host "Running Phase 1A.4 disposable verification..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a4.sql")

Write-Host "Running Phase 1A.5 disposable verification..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-fixture-reset.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a5.sql")

Write-Host "Running Phase 1A.5 packaging defect verification..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a5-packaging.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\production-verify-phase1a5-post.sql")

Write-Host "Running Phase 1A.4 agent reference hotfix verification..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a4-agent-ref-hotfix.sql")

Write-Host "Running Phase 1A.6 disposable verification..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a6.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a6-finalize-binding.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\production-verify-phase1a6-post.sql")

Write-Host "Running Phase 1A.3 concurrency check..."
& (Join-Path $Root "scripts\disposable-concurrency-phase1a3.ps1") -DatabaseUrl $DatabaseUrl

Write-Host "Running Phase 1A.4 concurrency check..."
& (Join-Path $Root "scripts\disposable-concurrency-phase1a4.ps1") -DatabaseUrl $DatabaseUrl

Write-Host "Running Phase 1A.6 concurrency check..."
& (Join-Path $Root "scripts\disposable-concurrency-phase1a6.ps1") -DatabaseUrl $DatabaseUrl

Write-Host "Running Phase 1A.7 disposable verification..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a7.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\production-verify-phase1a7-post.sql")

Write-Host "Running Phase 1A.8 disposable verification..."
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-fixture-phase1a8.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a8.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\production-verify-phase1a8-post.sql")

Write-Host "Running Phase 1A.9 disposable verification..."
Invoke-PsqlFile (Join-Path $Root "scripts\production-verify-phase1a9-pre.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\production-verify-phase1a9-visit-date-pre.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-fixture-phase1a9.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-verify-phase1a9.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\production-verify-phase1a9-post.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\production-verify-phase1a9-visit-date-post.sql")
Invoke-PsqlFile (Join-Path $Root "scripts\disposable-privilege-matrix-phase1a9.sql")

Write-Host "fixture_apply_pass"
