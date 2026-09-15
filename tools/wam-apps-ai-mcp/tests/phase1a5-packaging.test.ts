import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledMigrationsDir, packageRoot } from "./resolve-migrations.js";

const root = packageRoot();
const scripts = join(root, "scripts");
const migrations = bundledMigrationsDir();

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Phase 1A.5 packaging defect regressions", () => {
  it("production-verify-phase1a5-post resolves functions by OID or full regprocedure", () => {
    const sql = read(join(scripts, "production-verify-phase1a5-post.sql"));

    // Must not pass bare names like 'wam_ai.mark_lead_kyc_completed' to has_function_privilege.
    expect(sql).not.toMatch(
      /has_function_privilege\s*\(\s*[^,]+,\s*'wam_ai\.'\s*\|\|/,
    );
    expect(sql).not.toMatch(
      /has_function_privilege\s*\(\s*[^,]+,\s*'wam_ai\.[a-z_]+'\s*,/,
    );

    expect(sql).toMatch(/to_regprocedure\s*\(/);
    expect(sql).toMatch(/has_function_privilege\s*\(\s*v_role\s*,\s*v_oid\s*,/);
    expect(sql).toContain(
      "wam_ai.mark_lead_kyc_completed(uuid,text,uuid,uuid,text,text,text,text)",
    );
    expect(sql).toContain(
      "wam_ai.mark_lead_pending_install(uuid,text,uuid,uuid,text,text,text,text)",
    );
    expect(sql).toContain(
      "wam_ai.set_agent_fallback_dispatch(uuid,text,boolean,integer,uuid,uuid,text,text,text)",
    );
  });

  it("financial hardening revokes broad EXECUTE then restores actions grant on recreated lead RPCs", () => {
    const sql = read(
      join(migrations, "20260828215000_wam_ai_phase1a5_financial_hardening.sql"),
    );

    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION wam_ai\.mark_lead_kyc_completed\([\s\S]*?\) FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION wam_ai\.mark_lead_pending_install\([\s\S]*?\) FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION %s TO wam_ai_business_actions/,
    );
    expect(sql).toMatch(/proname IN \('mark_lead_kyc_completed', 'mark_lead_pending_install'\)/);

    // Must not revoke the actions grant from the recreated lead RPCs without restoring it.
    const privBlock = sql.slice(sql.lastIndexOf("DO $priv$"));
    const leadLoop = privBlock.slice(
      privBlock.indexOf("mark_lead_kyc_completed', 'mark_lead_pending_install"),
    );
    expect(leadLoop).toMatch(/GRANT EXECUTE ON FUNCTION %s TO wam_ai_business_actions/);
    expect(leadLoop).toMatch(/REVOKE ALL ON FUNCTION %s FROM wam_ai_business_readonly/);
    expect(leadLoop).not.toMatch(
      /REVOKE ALL ON FUNCTION %s FROM wam_ai_business_actions/,
    );
  });
});
