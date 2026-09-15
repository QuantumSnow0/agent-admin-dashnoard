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

describe("Phase 1A.7 packaging", () => {
  it("migration and verifiers exist", () => {
    expect(() =>
      read(join(migrations, "20260828240000_wam_ai_phase1a7_intelligence_infrastructure.sql")),
    ).not.toThrow();
    expect(() =>
      read(join(migrations, "20260828241000_wam_ai_phase1a7_reconcile_remediation.sql")),
    ).not.toThrow();
    expect(() => read(join(scripts, "disposable-verify-phase1a7.sql"))).not.toThrow();
    expect(() => read(join(scripts, "production-verify-phase1a7-pre.sql"))).not.toThrow();
    expect(() => read(join(scripts, "production-verify-phase1a7-post.sql"))).not.toThrow();
  });

  it("production migration contains no ALTER TABLE public.*", () => {
    const sql = read(
      join(migrations, "20260828240000_wam_ai_phase1a7_intelligence_infrastructure.sql"),
    );
    const rem = read(
      join(migrations, "20260828241000_wam_ai_phase1a7_reconcile_remediation.sql"),
    );
    const alterPublic = /^\s*ALTER TABLE public\./gim;
    expect(sql.match(alterPublic)).toBeNull();
    expect(rem.match(alterPublic)).toBeNull();
  });

  it("pre-verifier fails closed on missing canonical columns", () => {
    const sql = read(join(scripts, "production-verify-phase1a7-pre.sql"));
    expect(sql).toContain("required canonical columns absent");
    expect(sql).toContain("public.agents.created_at");
    expect(sql).toContain("public.safaricom_registrations.safaricom_number");
    expect(sql).toContain("must not ALTER public tables");
  });

  it("post-verifier isolates intelligence RPCs to readonly only", () => {
    const sql = read(join(scripts, "production-verify-phase1a7-post.sql"));
    expect(sql).toContain("to_regprocedure");
    expect(sql).toContain("wam_ai.reconcile_customer_batch(jsonb)");
    expect(sql).toContain("'wam_ai_business_actions'");
    expect(sql).toMatch(/has_function_privilege\s*\(\s*v_denied_role/);
  });

  it("reconcile uses connected-component identity and unique-customer counts", () => {
    const sql = read(
      join(migrations, "20260828240000_wam_ai_phase1a7_intelligence_infrastructure.sql"),
    );
    expect(sql).toContain("exact_normalized_phone_connected_components");
    expect(sql).toContain("unique_input_customers");
    expect(sql).toContain("installed_unique_customers");
    expect(sql).toContain("installed_inbound_lead_only_unique_customers");
    expect(sql).toContain("counting_policy");
    expect(sql).toContain("Names are never used as confirmed matches");
    expect(sql).toContain("Maximum 250 input rows");
    expect(sql).not.toContain("'record_id'");
    expect(sql).toContain("'lead_ref'");
    expect(sql).toContain("'registration_ref'");
  });

  it("lifecycle refuses invented approval timestamps", () => {
    const sql = read(
      join(migrations, "20260828240000_wam_ai_phase1a7_intelligence_infrastructure.sql"),
    );
    expect(sql).toContain("'approved_at_available', false");
    expect(sql).toContain("never treat as join or approval date");
  });

  it("disposable fixtures stub public columns outside production migration", () => {
    const stubs = read(join(scripts, "disposable-stubs.sql"));
    expect(stubs).toContain("ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS created_at");
    expect(stubs).toContain(
      "ALTER TABLE public.safaricom_registrations ADD COLUMN IF NOT EXISTS safaricom_number",
    );
  });
});
