-- =============================================================================
-- WAM APPS AI Phase 1A — PUBLIC privilege hardening (SEPARATE from reporting)
-- Local only until production approval. Review/apply/rollback independently.
--
-- Live finding (Aug 2026): 21 public.* functions are EXECUTE-able by PUBLIC.
-- Any LOGIN role (including future wam_ai_business_readonly) inherits those
-- privileges. This migration revokes PUBLIC execute on mutation/DEFINER/
-- trigger surfaces while restoring explicit grants required by apps.
--
-- Direct PostgreSQL login for WAM AI remains CONDITIONAL on privilege-gate
-- pass after this migration. If app smoke tests fail, roll back this file
-- and use an Edge Function / locked reporting API instead.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Affected functions and classification
-- ---------------------------------------------------------------------------
-- admin_reverse_agent_payment(uuid)     | app-called RPC | GRANT authenticated (restore)
-- agents_clear_dispatch_availability()  | trigger-only    | no app RPC
-- agents_protect_self_update()          | trigger-only
-- create_payout_notification()          | trigger-only
-- handle_new_user()                     | trigger-only (auth)
-- create_account_status_notification()  | trigger-only
-- create_earnings_update_notification() | trigger-only
-- create_registration_status_notification() | trigger-only
-- recalculate_agent_airtel_earnings(uuid) | SQL-internal via triggers
-- update_agent_balance()                | trigger-only
-- set_inbound_leads_updated_at()        | trigger-only
-- sync_agent_dispatch_county()          | trigger-only
-- update_*_updated_at() helpers         | trigger-only
--
-- NOT revoked here (follow-up): is_user_admin, is_admin_user, normalize_town_key,
-- resolve_county_from_town — keep PUBLIC until RLS/helper callers confirmed.
-- ---------------------------------------------------------------------------

-- Recorded existing explicit grants (restore after REVOKE FROM PUBLIC):
--   GRANT EXECUTE ON FUNCTION public.admin_reverse_agent_payment(uuid) TO authenticated;
--   (from add_agent_payments_reverse_function.sql)

REVOKE EXECUTE ON FUNCTION public.admin_reverse_agent_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reverse_agent_payment(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.agents_clear_dispatch_availability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agents_protect_self_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_payout_notification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_account_status_notification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_earnings_update_notification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_registration_status_notification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalculate_agent_airtel_earnings(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_agent_balance() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_inbound_leads_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_agent_dispatch_county() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_app_version_config_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_commission_rates_config_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_customer_registrations_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_device_tokens_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_safaricom_registrations_updated_at() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Application compatibility verification (manual smoke — do not skip)
-- ---------------------------------------------------------------------------
-- 1) Admin dashboard: reverse an accidental payment as authenticated admin
--    (agent-payment-manager.tsx → admin_reverse_agent_payment).
-- 2) Agent app: registration install → balance/notification triggers fire.
-- 3) Auth signup → handle_new_user still creates agent row.
-- 4) Lead dispatch: offer accept / self profile update still works.
-- 5) Run tools/wam-apps-ai-mcp/scripts/privilege-gate.sql after AI role exists.
--
-- Rollback SQL (restore PUBLIC execute — security-negative; use only if apps break):
--   GRANT EXECUTE ON FUNCTION public.admin_reverse_agent_payment(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.agents_clear_dispatch_availability() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.agents_protect_self_update() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.create_payout_notification() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.create_account_status_notification() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.create_earnings_update_notification() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.create_registration_status_notification() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.recalculate_agent_airtel_earnings(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.update_agent_balance() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.set_inbound_leads_updated_at() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.sync_agent_dispatch_county() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.update_app_version_config_updated_at() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.update_commission_rates_config_updated_at() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.update_customer_registrations_updated_at() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.update_device_tokens_updated_at() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.update_safaricom_registrations_updated_at() TO PUBLIC;
-- =============================================================================
