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

describe("Phase 1A.6 packaging regressions", () => {
  it("production-verify-phase1a6-post resolves functions by OID or full regprocedure", () => {
    const sql = read(join(scripts, "production-verify-phase1a6-post.sql"));

    expect(sql).not.toMatch(
      /has_function_privilege\s*\(\s*[^,]+,\s*'wam_ai\.'\s*\|\|/,
    );
    expect(sql).not.toMatch(
      /has_function_privilege\s*\(\s*[^,]+,\s*'wam_ai\.[a-z_]+'\s*,/,
    );
    expect(sql).toMatch(/to_regprocedure\s*\(/);
    expect(sql).toMatch(/has_function_privilege\s*\(\s*v_role\s*,\s*v_oid\s*,/);
    expect(sql).toContain(
      "wam_ai.prepare_send_agent_sms(uuid,text,text,text,uuid,uuid,text,text,text,text,text,text)",
    );
    expect(sql).toContain(
      "wam_ai.finalize_send_agent_sms(uuid,uuid,text,text,text,text,text,text,boolean,text)",
    );
  });

  it("privilege-gate requires SMS read RPC EXECUTE grants", () => {
    const sql = read(join(scripts, "privilege-gate.sql"));
    expect(sql).toContain("wam_ai.preview_agent_sms_recipient(uuid,text,text)");
    expect(sql).toContain(
      "wam_ai.get_agent_sms_history(uuid,text,timestamptz,timestamptz,integer)",
    );
    expect(sql).toContain("wam_ai.get_sms_delivery_status(text,uuid,text)");
    expect(sql).toMatch(
      /has_function_privilege[\s\S]*preview_agent_sms_recipient/,
    );
  });

  it("action-privilege-gate allowlists prepare/finalize only for actions role", () => {
    const sql = read(join(scripts, "action-privilege-gate.sql"));
    expect(sql).toContain("'prepare_send_agent_sms'");
    expect(sql).toContain("'finalize_send_agent_sms'");
    expect(sql).toContain("wam_ai.sms_send_intents");
  });

  it("phase1a6 migrations exist in bundled migrations/", () => {
    expect(() =>
      read(
        join(migrations, "20260828230000_wam_ai_phase1a6_sms_infrastructure.sql"),
      ),
    ).not.toThrow();
    expect(() =>
      read(join(migrations, "20260828231000_wam_ai_phase1a6_sms_actions.sql")),
    ).not.toThrow();
    expect(() =>
      read(
        join(
          migrations,
          "20260828232000_wam_ai_phase1a6_finalize_reservation_binding.sql",
        ),
      ),
    ).not.toThrow();
  });

  it("finalize_send_agent_sms binds correlation/actor/role to reservation", () => {
    const sql = read(
      join(migrations, "20260828232000_wam_ai_phase1a6_finalize_reservation_binding.sql"),
    );
    expect(sql).toContain("correlation_id does not match reservation");
    expect(sql).toContain("actor_id does not match reservation");
    expect(sql).toContain("actor_role does not match reservation");
    expect(sql).toContain("SMS finalize is restricted to technical_owner");
    expect(sql).toMatch(
      /INSERT INTO wam_ai\.action_events[\s\S]*v_intent\.correlation_id[\s\S]*v_intent\.actor_id[\s\S]*v_intent\.actor_role/,
    );
    expect(sql).not.toMatch(
      /INSERT INTO wam_ai\.action_events[\s\S]*VALUES \(\s*p_correlation_id/,
    );
    expect(sql).toMatch(
      /'correlation_id',\s*v_intent\.correlation_id/,
    );
  });

  it("business_partner ops remediation extends SMS finalize gateway roles", () => {
    const sql = read(
      join(
        migrations,
        "20260912180000_wam_ai_business_partner_ops_authorization.sql",
      ),
    );
    expect(sql).toContain(
      "SMS finalize is restricted to technical_owner or business_partner",
    );
    expect(sql).toContain(
      "SMS send is restricted to technical_owner or business_partner",
    );
    expect(sql).toContain(
      "Dispatch configuration requires technical_owner or business_partner",
    );
    expect(sql).toContain("correlation_id does not match reservation");
    expect(sql).toContain("actor_id does not match reservation");
    expect(sql).toContain("actor_role does not match reservation");
  });

  it("production-verify-phase1a6-post proves finalize binding and privilege isolation", () => {
    const sql = read(join(scripts, "production-verify-phase1a6-post.sql"));
    expect(sql).toContain("correlation_id does not match reservation");
    expect(sql).toContain("actor_id does not match reservation");
    expect(sql).toContain("actor_role does not match reservation");
    expect(sql).toContain("wam_ai_business_readonly");
    expect(sql).toContain("'public'");
    expect(sql).toContain("'anon'");
    expect(sql).toContain("'authenticated'");
    expect(sql).toMatch(/has_function_privilege\s*\(\s*v_denied_role\s*,\s*v_oid/);
  });

  it("disposable finalize-binding verifier covers mismatch cases", () => {
    const sql = read(
      join(scripts, "disposable-verify-phase1a6-finalize-binding.sql"),
    );
    expect(sql).toContain("mismatched correlation");
    expect(sql).toContain("mismatched actor_id");
    expect(sql).toContain("mismatched actor_role");
    expect(sql).toContain("null actor_role");
    expect(sql).toContain("poisoned non-technical_owner");
    expect(sql).toContain("idempotent_replay");
    expect(sql).toContain("phase1a6_finalize_reservation_binding_pass");
  });
});