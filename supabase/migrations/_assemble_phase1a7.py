from pathlib import Path
import re

root = Path(r"c:\Users\Boniface\Desktop\airtel-agent\admin-dashboard\supabase\migrations")
mcp = Path(r"c:\Users\Boniface\Desktop\airtel-agent\admin-dashboard\tools\wam-apps-ai-mcp\migrations")

reconcile = (root / "_phase1a7_reconcile_body.sql").read_text(encoding="utf-8").replace("\ufeff", "")
lifecycle = (root / "_phase1a7_lifecycle_body.sql").read_text(encoding="utf-8").replace("\ufeff", "")

# Canonical catalogue from a clean snippet file if present, else embedded
catalogue_path = root / "_phase1a7_catalogue_body.sql"
if not catalogue_path.exists():
    raise SystemExit("missing catalogue body")

catalogue = catalogue_path.read_text(encoding="utf-8").replace("\ufeff", "")

header = """-- =============================================================================
-- WAM APPS AI Phase 1A.7 — Operational intelligence (read-only)
-- Remediated v0.1.15: no ALTER TABLE public.*; unique-customer counts;
-- spreadsheet phone-overlap identity; hub lead_id identity; safe refs only.
-- =============================================================================

"""

grants = """
REVOKE ALL ON FUNCTION wam_ai.reconcile_customer_batch(jsonb) FROM PUBLIC, anon, authenticated;
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

full = header + reconcile.rstrip() + "\n\n" + lifecycle.rstrip() + "\n\n" + catalogue.rstrip() + "\n" + grants
assert not re.findall(r"(?m)^\s*ALTER TABLE public\.", full)
assert "AS \\$" not in full
assert "DO \\$" not in full
assert full.count("AS $fn$") >= 3

for p in [
    root / "20260828240000_wam_ai_phase1a7_intelligence_infrastructure.sql",
    mcp / "20260828240000_wam_ai_phase1a7_intelligence_infrastructure.sql",
]:
    p.write_bytes(full.encode("utf-8"))

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

for p in [
    root / "20260828241000_wam_ai_phase1a7_reconcile_remediation.sql",
    mcp / "20260828241000_wam_ai_phase1a7_reconcile_remediation.sql",
]:
    p.write_bytes(remediate.encode("utf-8"))

print("ok", len(full), "fn tags", full.count("AS $fn$"))
