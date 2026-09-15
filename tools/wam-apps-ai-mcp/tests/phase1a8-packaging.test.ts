import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bundledMigrationsDir,
  packageRoot,
  repoSupabaseMigrationsDir,
} from "./resolve-migrations.js";

const root = packageRoot();
const migrations = bundledMigrationsDir();

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Phase 1A.8 packaging", () => {
  it("session migrations exist in bundled migrations/ and grant readonly only", () => {
    const sql = read(join(migrations, "20260829120000_wam_ai_phase1a8_reconcile_sessions.sql"));
    expect(sql).toContain("begin_reconcile_session");
    expect(sql).toContain("finalize_reconcile_session");
    expect(sql).toContain("set_config('wam_ai.reconcile_max_rows'");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION wam_ai.finalize_reconcile_session");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION wam_ai\.begin_reconcile_session[\s\S]*wam_ai_business_actions/);
  });

  it("cap GUC migration keeps default 250 (historical)", () => {
    const sql = read(join(migrations, "20260829121000_wam_ai_phase1a8_reconcile_cap_guc.sql"));
    expect(sql).toContain("v_max_rows integer := 250");
    expect(sql).toContain("wam_ai.reconcile_max_rows");
    expect(sql).not.toMatch(/^\s*ALTER TABLE public\./m);
  });

  it("session security remediation supersedes GUC bypass for 0.1.18", () => {
    const name = "20260829130000_wam_ai_phase1a8_session_security_remediation.sql";
    const sql = read(join(migrations, name));

    // When run inside the monorepo, bundled copy must match supabase migrations.
    // Clean-archive extraction has no repo path — skip parity, still assert content.
    const repoDir = repoSupabaseMigrationsDir();
    if (repoDir) {
      expect(sql).toBe(read(join(repoDir, name)));
    }

    expect(sql).toContain("_reconcile_customer_batch_internal");
    expect(sql).toContain("_reconcile_customer_batch_session");
    expect(sql).toContain("cleanup_own_reconcile_sessions");
    expect(sql).toContain("raw_rows_deleted");
    expect(sql).toContain("SELECT wam_ai._reconcile_customer_batch_internal(p_rows, 250)");
    expect(sql).toContain("SELECT wam_ai._reconcile_customer_batch_internal(p_rows, 5000)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION wam_ai.cleanup_expired_reconcile_sessions(integer) FROM wam_ai_business_readonly");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION wam_ai.cleanup_own_reconcile_sessions(text, text, integer) TO wam_ai_business_readonly");
    // Public batch must not read caller-settable GUC after remediation
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION wam_ai\.reconcile_customer_batch[\s\S]*current_setting\(['"]wam_ai\.reconcile_max_rows/);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION wam_ai\.reconcile_customer_batch[\s\S]*set_config\(['"]wam_ai\.reconcile_max_rows/);
  });

  it("document tools are registered in package source", () => {
    const server = read(join(root, "src", "server.ts"));
    expect(server).toContain("documents");
    // Version may advance in later phases; 1A.8 remediation remains in tree.
    expect(server).toMatch(/version:\s*"0\.1\.\d+"/);
    const pkg = JSON.parse(read(join(root, "package.json"))) as { version: string; dependencies: Record<string, string> };
    expect(pkg.version).toMatch(/^0\.1\.\d+$/);
    expect(pkg.dependencies.exceljs).toBeTruthy();
    expect(pkg.dependencies.jszip).toBeTruthy();
    const intel = read(join(root, "src", "validation-intelligence.ts"));
    expect(intel).toContain("sqlJsonb");
    const db = read(join(root, "src", "db.ts"));
    expect(db).toContain("buildTypedSqlArgs");
    expect(db).toContain("cleanup_own_reconcile_sessions");
    expect(db).not.toContain("cleanup_expired_reconcile_sessions");
  });

  it("privilege gate and fixture grants match remediation ACL", () => {
    const gate = read(join(root, "scripts", "privilege-gate.sql"));
    expect(gate).toContain("cleanup_own_reconcile_sessions(text,text,integer)");
    expect(gate).toContain("readonly must not EXECUTE cleanup_expired_reconcile_sessions");
    expect(gate).toContain("_reconcile_customer_batch_session(jsonb)");

    const post = read(join(root, "scripts", "production-verify-phase1a8-post.sql"));
    expect(post).toContain("cleanup_own_reconcile_sessions");
    expect(post).toContain("readonly has EXECUTE on");

    const fixture = read(join(root, "scripts", "apply-disposable-fixture.ps1"));
    expect(fixture).toContain("20260829130000_wam_ai_phase1a8_session_security_remediation.sql");
    expect(fixture).toContain("cleanup_own_reconcile_sessions(text,text,integer)");
    expect(fixture).not.toMatch(/GRANT EXECUTE ON FUNCTION wam_ai\.cleanup_expired_reconcile_sessions\(integer\) TO wam_ai_business_readonly/);
  });
});
