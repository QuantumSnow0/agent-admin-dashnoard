import { describe, expect, it, beforeEach } from "vitest";
import {
  loadConfig,
  resolveActorFromConfig,
  validateConfigForStart,
} from "../src/config.js";
import { createMockDbClient } from "../src/db.js";
import {
  assertNoPiiKeys,
  hashParams,
  redactParams,
  sanitizeErrorMessage,
  truncateJson,
} from "../src/redact.js";
import { checkRateLimit, resetRateLimitState } from "../src/rateLimit.js";
import { argsContainForbiddenSql, resolveActor } from "../src/server.js";
import { executeBusinessTool, listBusinessTools, parseToolName } from "../src/tools.js";
import {
  BUSINESS_TOOL_NAMES,
  FORBIDDEN_TOOL_NAMESPACES,
  STALL_CODES,
  TOOL_SCHEMAS,
  TOOL_TO_SQL,
  ValidationError,
  validateLimit,
  validateRange,
} from "../src/validation.js";

const actor = {
  actorId: "unverified:t",
  actorRole: "business_partner" as const,
  sessionOrChannelId: "s" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-1" as string | null,
};

function baseCfg() {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_MAX_RESPONSE_CHARS: "5000",
    WAM_AI_INSTANCE_ID: "dev-1",
    WAM_AI_INSTANCE_ACTOR_ID: "t",
    WAM_AI_INSTANCE_ACTOR_ROLE: "business_partner",
  });
}

beforeEach(() => {
  resetRateLimitState();
});

describe("validation", () => {
  it("defaults allow omitted dates", () => {
    expect(validateRange(undefined, undefined)).toEqual({ from: null, to: null });
  });

  it("rejects reversed ranges", () => {
    expect(() =>
      validateRange("2026-08-20T00:00:00.000Z", "2026-08-10T00:00:00.000Z"),
    ).toThrow(ValidationError);
  });

  it("rejects invalid dates", () => {
    expect(() => validateRange("not-a-date", undefined)).toThrow(ValidationError);
  });

  it("rejects ranges over 90 days", () => {
    expect(() =>
      validateRange("2026-01-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"),
    ).toThrow(ValidationError);
  });

  it("enforces limit bounds", () => {
    expect(validateLimit(undefined)).toBeNull();
    expect(validateLimit(50)).toBe(50);
    expect(() => validateLimit(0)).toThrow(ValidationError);
    expect(() => validateLimit(101)).toThrow(ValidationError);
  });
});

describe("tool catalog", () => {
  it("exposes only business analytics tools", () => {
    const tools = listBusinessTools();
    expect(tools).toHaveLength(10);
    for (const t of tools) {
      expect(t.name.startsWith("wam.business.analytics.")).toBe(true);
      for (const bad of FORBIDDEN_TOOL_NAMESPACES) {
        expect(t.name.startsWith(bad)).toBe(false);
      }
    }
    expect(tools.some((t) => t.name.includes("investigate"))).toBe(false);
    expect(BUSINESS_TOOL_NAMES).not.toContain("investigate_customer_or_lead" as never);
  });

  it("maps tool names one-to-one", () => {
    expect(parseToolName("wam.business.analytics.get_operational_summary")).toBe(
      "get_operational_summary",
    );
    expect(parseToolName("wam.technical.deploy")).toBeNull();
    expect(parseToolName("sql")).toBeNull();
  });

  it("documents all stall classifications", () => {
    expect(STALL_CODES).toEqual(
      expect.arrayContaining([
        "DISPATCH_BACKLOG",
        "STUCK_OFFER",
        "AGENT_FOLLOWUP_OVERDUE",
        "KYC_STALLED",
        "INSTALLATION_FOLLOWUP_REQUIRED",
        "ADMIN_INSTALL_REVIEW_BACKLOG",
        "DEFERRED_CALLBACK_OVERDUE",
      ]),
    );
  });

  it("has no mutating or investigation tools", () => {
    const names = Object.keys(TOOL_TO_SQL);
    expect(names.every((n) => n.startsWith("get_") || n.startsWith("find_"))).toBe(true);
    expect(
      names.some((n) =>
        /(^|_)(write|update|insert|delete|reassign|pause|deploy|investigate|admin|availability)(_|$)/i.test(
          n,
        ),
      ),
    ).toBe(false);
    expect(names).not.toContain("investigate_customer_or_lead");
    expect(names).toContain("get_commission_payment_summary");
  });

  it("rejects arbitrary SQL argument keys", () => {
    expect(argsContainForbiddenSql({ sql: "select 1" })).toBe(true);
    expect(argsContainForbiddenSql({ query: "x" })).toBe(true);
    expect(argsContainForbiddenSql({ limit: 10 })).toBe(false);
  });

  it("advertises exact per-tool schemas", () => {
    expect(TOOL_SCHEMAS.get_operational_summary.properties).toHaveProperty("product");
    expect(TOOL_SCHEMAS.get_operational_summary.properties).not.toHaveProperty("limit");
    expect(TOOL_SCHEMAS.get_unassigned_leads.properties).toHaveProperty("county");
    expect(TOOL_SCHEMAS.get_registration_install_trends.properties).toHaveProperty("grain");
    expect(TOOL_SCHEMAS.get_overdue_or_stalled_leads.properties).not.toHaveProperty("from");
    for (const name of BUSINESS_TOOL_NAMES) {
      expect(TOOL_SCHEMAS[name].additionalProperties).toBe(false);
      expect(TOOL_SCHEMAS[name].type).toBe("object");
    }
  });
});

describe("redaction and size", () => {
  it("redacts sensitive keys and hashes stably", () => {
    const r = redactParams({ phone: "0712345678", limit: 10 });
    expect(r.phone).toBe("[REDACTED]");
    expect(r.limit).toBe(10);
    expect(hashParams({ a: 1 })).toHaveLength(32);
  });

  it("sanitizes connection strings from errors", () => {
    const s = sanitizeErrorMessage(
      new Error("fail postgres://user:secret@host:5432/db timeout"),
    );
    expect(s.message).not.toContain("secret");
    expect(s.category).toBe("database_unavailable");
  });

  it("truncates large payloads without preview", () => {
    const big = { x: "y".repeat(1000) };
    const t = truncateJson(big, 100);
    expect(t.truncated).toBe(true);
    expect(JSON.stringify(t.payload)).not.toContain("yyy");
    expect((t.payload as { truncated: boolean }).truncated).toBe(true);
    expect(t.payload).not.toHaveProperty("preview");
  });

  it("detects PII keys", () => {
    expect(assertNoPiiKeys({ lead_ref: "L-1" })).toEqual([]);
    expect(assertNoPiiKeys({ primary_phone: "x" }).length).toBeGreaterThan(0);
    expect(assertNoPiiKeys({ dedupe_phone_key: "x" }).length).toBeGreaterThan(0);
  });
});

describe("executeBusinessTool", () => {
  it("denies when kill switch enabled", async () => {
    const db = createMockDbClient();
    const cfg = { ...baseCfg(), killSwitch: true };
    const res = await executeBusinessTool({
      tool: "get_operational_summary",
      args: {},
      cfg,
      db,
      actor,
    });
    expect(res.ok).toBe(false);
    expect(res.denied).toBe(true);
    expect(res.error?.category).toBe("kill_switch");
    expect(db.audits.length).toBe(1);
    expect(db.audits[0]?.correlationId).toBe(res.auditId);
  });

  it("rejects unsupported filters", async () => {
    const db = createMockDbClient();
    const res = await executeBusinessTool({
      tool: "get_operational_summary",
      args: { product: "savanna" },
      cfg: baseCfg(),
      db,
      actor: { ...actor, sessionOrChannelId: null },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("validation");
  });

  it("calls fixed SQL mapping and audits success with correlation", async () => {
    const db = createMockDbClient({
      call: async (fn, args) => {
        expect(fn).toBe("get_unassigned_leads");
        expect(args[0]).toBe(10);
        return {
          definition: "assignment_attention",
          excludes: ["deferred"],
          leads: [{ lead_ref: "L-abc", status: "admin_queue" }],
          result_count: 1,
        };
      },
    });
    const res = await executeBusinessTool({
      tool: "get_unassigned_leads",
      args: { limit: 10 },
      cfg: baseCfg(),
      db,
      actor: { ...actor, actorId: "partner-1", sessionOrChannelId: "ch" },
    });
    expect(res.ok).toBe(true);
    expect(res.auditId).toBeTruthy();
    expect(res.correlationId).toBe(res.auditId);
    expect(db.audits.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(db.audits.map((a) => a.correlationId));
    expect(ids.size).toBe(1);
    expect(ids.has(res.auditId!)).toBe(true);
    expect((res.data as { excludes: string[] }).excludes).toContain("deferred");
  });

  it("fail-closed: does not call reporting if pre-audit fails", async () => {
    const db = createMockDbClient({ auditFail: true });
    const res = await executeBusinessTool({
      tool: "get_operational_summary",
      args: {},
      cfg: baseCfg(),
      db,
      actor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("audit_unavailable");
    expect(db.callCount).toBe(0);
    expect(res.data).toBeUndefined();
  });

  it("fail-closed: does not return data if completion audit fails", async () => {
    const db = createMockDbClient({
      auditFailAfter: 1,
      call: async () => ({ inbound_leads: 99, secret_should_not_leak_as_success: true }),
    });
    const res = await executeBusinessTool({
      tool: "get_operational_summary",
      args: {},
      cfg: baseCfg(),
      db,
      actor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("audit_unavailable");
    expect(res.data).toBeUndefined();
    expect(db.callCount).toBe(1);
  });

  it("blocks PII leakage from DB results", async () => {
    const db = createMockDbClient({
      call: async () => ({ primary_phone: "0711" }),
    });
    const res = await executeBusinessTool({
      tool: "get_operational_summary",
      args: {},
      cfg: baseCfg(),
      db,
      actor: { ...actor, actorRole: "unknown", sessionOrChannelId: null },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("pii_guard");
  });

  it("handles DB errors safely without inventing numbers", async () => {
    const db = createMockDbClient({
      call: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const res = await executeBusinessTool({
      tool: "get_commission_payment_summary",
      args: {},
      cfg: baseCfg(),
      db,
      actor: { ...actor, sessionOrChannelId: null },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("database_unavailable");
    expect(JSON.stringify(res)).not.toMatch(/earned|paid|1234/);
  });

  it("uses commission vs payment terminology fields when present", async () => {
    const db = createMockDbClient({
      call: async () => ({
        terminology: {
          commission_earned: "x",
          payment_made: "y",
          outstanding_balance: "unavailable_in_phase_1a",
        },
        outstanding_balance_status: "unavailable",
        payments_paid_ksh: 10,
        inbound_install_commission_earned_ksh: 20,
      }),
    });
    const res = await executeBusinessTool({
      tool: "get_commission_payment_summary",
      args: {},
      cfg: baseCfg(),
      db,
      actor: { ...actor, sessionOrChannelId: null },
    });
    expect(res.ok).toBe(true);
    const d = res.data as {
      outstanding_balance_status: string;
      terminology: { outstanding_balance: string };
    };
    expect(d.outstanding_balance_status).toBe("unavailable");
    expect(d.terminology.outstanding_balance).toBe("unavailable_in_phase_1a");
  });

  it("returns response_too_large with no payload preview", async () => {
    const db = createMockDbClient({
      call: async () => ({ blob: "z".repeat(2000) }),
    });
    const cfg = { ...baseCfg(), maxResponseChars: 100 };
    const res = await executeBusinessTool({
      tool: "get_operational_summary",
      args: {},
      cfg,
      db,
      actor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("response_too_large");
    expect(res.data).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain("zzz");
  });

  it("ignores correlationId / actor supplied in tool args", async () => {
    const db = createMockDbClient({
      call: async () => ({ ok: true }),
    });
    const res = await executeBusinessTool({
      tool: "get_operational_summary",
      args: {
        correlationId: "11111111-1111-1111-1111-111111111111",
        actorId: "attacker",
        actorRole: "technical_owner",
      },
      cfg: baseCfg(),
      db,
      actor,
    });
    // Extra keys fail Zod .strict() → validation denial; either way never used as identity.
    if (res.ok) {
      expect(res.auditId).not.toBe("11111111-1111-1111-1111-111111111111");
      expect(db.audits.every((a) => a.actorId === actor.actorId)).toBe(true);
    } else {
      expect(res.error?.category).toBe("validation");
    }
  });
});

describe("identity and config", () => {
  it("rejects missing DB url and service_role-looking urls", () => {
    expect(validateConfigForStart(loadConfig({})).ok).toBe(false);
    expect(
      validateConfigForStart(
        loadConfig({
          WAM_AI_DATABASE_URL: "postgresql://x:service_role_key@h/db",
        }),
      ).errors.some((e) => /service-role/i.test(e)),
    ).toBe(true);
  });

  it("requires dedicated wam_ai_business_readonly username", () => {
    expect(
      validateConfigForStart(
        loadConfig({
          WAM_AI_IDENTITY_MODE: "development",
          WAM_AI_DATABASE_URL: "postgresql://postgres:x@localhost/db",
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateConfigForStart(
        loadConfig({
          WAM_AI_IDENTITY_MODE: "development",
          WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/db",
        }),
      ).ok,
    ).toBe(true);
  });

  it("development mode stays unverified", () => {
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "development",
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/db",
      WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
      WAM_AI_INSTANCE_ACTOR_ID: "bonface",
      WAM_AI_INSTANCE_ID: "dev",
    });
    expect(cfg.instanceActor.identityVerified).toBe(false);
    expect(cfg.instanceActor.actorId.startsWith("unverified:")).toBe(true);
    const resolved = resolveActor(cfg, {
      actorRole: "technical_owner",
      identityVerified: true,
      actorId: "spoof",
    });
    expect(resolved.identityVerified).toBe(false);
    expect(resolved.actorId).toBe(cfg.instanceActor.actorId);
    expect(resolved.actorId).not.toContain("spoof");
  });

  it("production startup fails without identity binding", () => {
    const missing = validateConfigForStart(
      loadConfig({
        WAM_AI_IDENTITY_MODE: "production",
        WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@h/db",
      }),
    );
    expect(missing.ok).toBe(false);
    expect(missing.errors.some((e) => /INSTANCE_ID/i.test(e))).toBe(true);

    const badRole = validateConfigForStart(
      loadConfig({
        WAM_AI_IDENTITY_MODE: "production",
        WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@h/db",
        WAM_AI_INSTANCE_ID: "gw-partner",
        WAM_AI_INSTANCE_ACTOR_ID: "partner-1",
        WAM_AI_INSTANCE_ACTOR_ROLE: "ai_service",
      }),
    );
    expect(badRole.ok).toBe(false);

    const ok = validateConfigForStart(
      loadConfig({
        WAM_AI_IDENTITY_MODE: "production",
        WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@h/db",
        WAM_AI_INSTANCE_ID: "gw-owner",
        WAM_AI_INSTANCE_ACTOR_ID: "bonface",
        WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
      }),
    );
    expect(ok.ok).toBe(true);
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "production",
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@h/db",
      WAM_AI_INSTANCE_ID: "gw-owner",
      WAM_AI_INSTANCE_ACTOR_ID: "bonface",
      WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
    });
    expect(cfg.instanceActor.identityVerified).toBe(true);
    expect(resolveActorFromConfig(cfg).actorRole).toBe("technical_owner");
  });

  it("defaults rate limit to 30/min", () => {
    const cfg = baseCfg();
    expect(cfg.rateLimitPerMinute).toBe(30);
  });
});

describe("rate limit unit", () => {
  it("allows then denies within the window", () => {
    const key = "inst::actor";
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, t0 + i).allowed).toBe(true);
    }
    const denied = checkRateLimit(key, 3, t0 + 10);
    expect(denied.allowed).toBe(false);
    resetRateLimitState();
    expect(checkRateLimit(key, 3, t0 + 20).allowed).toBe(true);
  });
});
