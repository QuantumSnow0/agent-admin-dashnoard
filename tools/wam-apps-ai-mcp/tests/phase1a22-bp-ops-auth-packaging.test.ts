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

describe("business_partner ops authorization packaging (v0.1.22)", () => {
  const migName = "20260912180000_wam_ai_business_partner_ops_authorization.sql";

  it("remediation migration is byte-mirrored to supabase/migrations", () => {
    const sql = read(join(migrations, migName));
    const repoDir = repoSupabaseMigrationsDir();
    if (repoDir) {
      expect(sql).toBe(read(join(repoDir, migName)));
    }
  });

  it("extends three business ops to business_partner without weakening SMS binding", () => {
    const sql = read(join(migrations, migName));
    expect(sql).toContain("set_agent_fallback_dispatch");
    expect(sql).toContain("set_agent_service_radius");
    expect(sql).toContain("prepare_send_agent_sms");
    expect(sql).toContain("finalize_send_agent_sms");
    expect(sql).toContain("NOT IN ('technical_owner', 'business_partner')");
    expect(sql).toContain("correlation_id does not match reservation");
    expect(sql).toContain("actor_id does not match reservation");
    expect(sql).toContain("actor_role does not match reservation");
    expect(sql).toMatch(/v_intent\.actor_id/);
    expect(sql).toMatch(/v_intent\.actor_role/);
    expect(sql).not.toMatch(/GRANT EXECUTE[\s\S]*TO PUBLIC/);
  });

  it("TypeScript gates no longer owner-only for fallback/radius/SMS send", () => {
    const actions = read(join(root, "src", "tools-actions.ts"));
    expect(actions).not.toMatch(
      /TECHNICAL_OWNER_ONLY_ACTIONS = new Set<ActionToolName>\(\[\s*"set_agent_fallback_dispatch"/,
    );
    expect(actions).toContain("technical_owner, business_partner");
    const sms = read(join(root, "src", "tools-sms.ts"));
    expect(sms).not.toContain('actor.actorRole !== "technical_owner"');
    expect(sms).toContain(
      "SMS send is limited to verified technical_owner and business_partner",
    );
  });

  it("package version is 0.1.22", () => {
    const pkg = JSON.parse(read(join(root, "package.json"))) as {
      version: string;
    };
    expect(pkg.version).toBe("0.1.22");
    expect(read(join(root, "src", "server.ts"))).toContain("0.1.22");
  });
});
