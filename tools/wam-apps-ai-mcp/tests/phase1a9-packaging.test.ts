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

describe("Phase 1A.9 packaging", () => {
  const migName = "20260910120000_wam_ai_phase1a9_semantic_query.sql";
  const remedName = "20260912120000_wam_ai_phase1a9_visit_date_dual_format.sql";

  it("migration is byte-mirrored and grants readonly only", () => {
    const sql = read(join(migrations, migName));
    const repoDir = repoSupabaseMigrationsDir();
    if (repoDir) {
      expect(sql).toBe(read(join(repoDir, migName)));
    }
    expect(sql).toContain("list_business_records");
    expect(sql).toContain("aggregate_business_metrics");
    expect(sql).toContain("Africa/Nairobi");
    expect(sql).toContain("_query_parse_mdy_date");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION wam_ai.list_business_records(jsonb) TO wam_ai_business_readonly");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION wam_ai\.list_business_records\(jsonb\) FROM PUBLIC/);
    expect(sql).toContain("wam_ai_business_actions");
    expect(sql).not.toMatch(/GRANT SELECT ON (TABLE )?public\.(agents|inbound_leads)/);
  });

  it("visit_date dual-format remediation is mirrored and forward-only", () => {
    const sql = read(join(migrations, remedName));
    const repoDir = repoSupabaseMigrationsDir();
    if (repoDir) {
      expect(sql).toBe(read(join(repoDir, remedName)));
    }
    expect(sql).toContain("YYYY-MM-DD");
    expect(sql).toContain("make_date");
    expect(sql).not.toMatch(/%L/);
    expect(sql).not.toContain("quote_literal");
    expect(sql).not.toMatch(/USING\s+VARIADIC/i);
    expect(sql).toContain("catalogue_version");
    expect(sql).toContain("1a9.2");
  });

  it("package version is 0.1.22 and query tools are wired", () => {
    const pkg = JSON.parse(read(join(root, "package.json"))) as { version: string };
    expect(pkg.version).toBe("0.1.22");
    const server = read(join(root, "src", "server.ts"));
    expect(server).toContain("0.1.22");
    expect(server).toContain("executeQueryTool");
    expect(server).toContain("QUERY_NAMESPACE");
    const db = read(join(root, "src", "db.ts"));
    expect(db).toContain("list_business_records");
    expect(db).toContain("aggregate_business_metrics");
  });

  it("migration binds user values via $1 JSONB, not format(%L)", () => {
    const sql = read(join(migrations, migName));
    expect(sql).not.toMatch(/%L/);
    expect(sql).not.toContain("quote_literal");
    expect(sql).not.toMatch(/USING\s+VARIADIC/i);
    expect(sql).toContain("($1->>");
    expect(sql).toContain("EXECUTE v_count_sql INTO v_total USING v_binds");
    expect(sql).toContain("EXECUTE v_sql USING v_binds");
  });

  it("privilege gate and fixture include Phase 1A.9 + visit_date remediation", () => {
    const gate = read(join(root, "scripts", "privilege-gate.sql"));
    expect(gate).toContain("list_business_records(jsonb)");
    expect(gate).toContain("action role can EXECUTE list_business_records");
    expect(gate).toContain("PUBLIC can EXECUTE list_business_records");

    const fixture = read(join(root, "scripts", "apply-disposable-fixture.ps1"));
    expect(fixture).toContain(migName);
    expect(fixture).toContain(remedName);
    expect(fixture).toContain(
      "20260912180000_wam_ai_business_partner_ops_authorization.sql",
    );
    expect(fixture).toContain("disposable-fixture-phase1a9.sql");
    expect(fixture).toContain("disposable-verify-phase1a9.sql");
    expect(fixture).toContain("production-verify-phase1a9-visit-date-pre.sql");
    expect(fixture).toContain("production-verify-phase1a9-visit-date-post.sql");
    expect(fixture).toContain("disposable-privilege-matrix-phase1a9.sql");
    expect(fixture).toContain("GRANT EXECUTE ON FUNCTION wam_ai.list_business_records(jsonb)");
  });

  it("query namespace has no mutation tools in source", () => {
    const tools = read(join(root, "src", "tools-query.ts"));
    expect(tools).toContain("wam.business.query");
    expect(tools).not.toMatch(/send_|create_|approve_|reject_|ban_|delete_/);
  });
});
