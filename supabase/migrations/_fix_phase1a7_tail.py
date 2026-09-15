from pathlib import Path

root = Path(r"c:\Users\Boniface\Desktop\airtel-agent\admin-dashboard\supabase\migrations")
mcp = Path(r"c:\Users\Boniface\Desktop\airtel-agent\admin-dashboard\tools\wam-apps-ai-mcp\migrations")
p = root / "20260828240000_wam_ai_phase1a7_intelligence_infrastructure.sql"
t = p.read_text(encoding="utf-8")
marker = "REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM PUBLIC, anon, authenticated;"
idx = t.rfind(marker)
assert idx > 0
head = t[:idx]
tail = """REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.get_notification_capability_catalogue() FROM PUBLIC, anon, authenticated;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.get_notification_capability_catalogue() FROM wam_ai_business_actions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.get_notification_capability_catalogue() TO wam_ai_business_readonly';
  END IF;
END;
$priv$;
"""
out = head + tail
assert "DO \\$" not in out
assert "AS \\$" not in out
assert "DO $priv$" in out
p.write_bytes(out.encode("utf-8"))
(mcp / p.name).write_bytes(out.encode("utf-8"))

# Keep remediation in sync via assemble pieces
reconcile = (root / "_phase1a7_reconcile_body.sql").read_text(encoding="utf-8").replace("\ufeff", "")
lifecycle = (root / "_phase1a7_lifecycle_body.sql").read_text(encoding="utf-8").replace("\ufeff", "")
remediate = (
    """-- =============================================================================
-- Phase 1A.7 remediation — recreate intelligence RPCs (no public table mutations)
-- =============================================================================

"""
    + reconcile.rstrip()
    + "\n\n"
    + lifecycle.rstrip()
    + """

REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) FROM PUBLIC, anon, authenticated;
DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_actions') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM wam_ai_business_actions';
    EXECUTE 'REVOKE ALL ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) FROM wam_ai_business_actions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wam_ai_business_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) TO wam_ai_business_readonly';
    EXECUTE 'GRANT EXECUTE ON FUNCTION wam_ai.get_agent_lifecycle(uuid, text) TO wam_ai_business_readonly';
  END IF;
END;
$priv$;
"""
)
(root / "20260828241000_wam_ai_phase1a7_reconcile_remediation.sql").write_bytes(remediate.encode("utf-8"))
(mcp / "20260828241000_wam_ai_phase1a7_reconcile_remediation.sql").write_bytes(remediate.encode("utf-8"))
print("ok", len(out))
