import { describe, expect, it, beforeEach } from "vitest";
import {
  ALLOWED_ACTOR_ROLES,
  loadConfig,
  OPENBOOK_ALLOWED_ROLES,
  validateActionConfig,
} from "../src/config.js";
import { createMockActionDbClient } from "../src/actionDb.js";
import { createMockDbClient } from "../src/db.js";
import { hashParams, redactParams } from "../src/redact.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { parseAnyToolName } from "../src/server.js";
import {
  executeActionTool,
  listActionTools,
  parseActionToolName,
} from "../src/tools-actions.js";
import {
  ACTION_TOOL_NAMES,
  ACTION_TOOL_SCHEMAS,
  parseActionArgs,
} from "../src/validation-actions.js";

const LEAD_ID = "77777777-7777-7777-7777-777777777777";
const AGENT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_BIZ = "A-11111111";
const IDEM_KEY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const partnerActor = {
  actorId: "unverified:partner",
  actorRole: "business_partner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

const ownerActor = { ...partnerActor, actorId: "unverified:owner", actorRole: "technical_owner" as const };
const aiActor = { ...partnerActor, actorRole: "ai_service" as const };
const unknownActor = { ...partnerActor, actorRole: "unknown" as const };

function devCfg(extra: Record<string, string> = {}) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_ACTION_DATABASE_URL: "postgresql://wam_ai_business_actions:x@localhost/postgres",
    WAM_AI_ACTIONS_ENABLED: "1",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "partner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "business_partner",
    ...extra,
  });
}

function baseOfferArgs(overrides: Record<string, unknown> = {}) {
  return {
    lead_id: LEAD_ID,
    agent_id: AGENT_ID,
    idempotency_key: IDEM_KEY,
    explicit_action_authorized: true as const,
    instruction_summary: "Offer lead to agent",
    ...overrides,
  };
}

function mockOfferSuccess(overrides: Record<string, unknown> = {}) {
  return {
    status: "success",
    operation: "create_lead_offer",
    idempotent_replay: false,
    offer_ref: "O-abc123",
    lead_ref: "L-77777777",
    agent_name: "Near Agent",
    agent_business_id: AGENT_BIZ,
    previous_lead_status: "admin_queue",
    resulting_lead_status: "offered",
    offer_status: "offered",
    agent_has_not_accepted: true,
    audit_reference: "corr-1",
    ...overrides,
  };
}

describe("Phase 1A.2b action catalog", () => {
  it("lists create_lead_offer when actions configured", () => {
    const tools = listActionTools(devCfg());
    expect(tools.map((t) => t.name)).toContain("wam.business.dispatch.create_lead_offer");
    expect(parseActionToolName("wam.business.dispatch.create_lead_offer")).toBe("create_lead_offer");
    expect(parseAnyToolName("wam.business.dispatch.create_lead_offer")?.kind).toBe("action");
  });

  it("schema rejects names and arbitrary SQL", () => {
    const schema = ACTION_TOOL_SCHEMAS.create_lead_offer;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).not.toContain("agent_name");
    expect(Object.keys(schema.properties)).not.toContain("sql");
    expect(ACTION_TOOL_NAMES).toContain("create_lead_offer");
    expect(ACTION_TOOL_NAMES.length).toBeGreaterThan(1);
  });
});

describe("authorization", () => {
  beforeEach(() => resetRateLimitState());

  it("allows technical_owner", async () => {
    const actionDb = createMockActionDbClient({
      call: async () => mockOfferSuccess(),
    });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg({ WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner" }),
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(r.ok).toBe(true);
  });

  it("allows business_partner", async () => {
    const actionDb = createMockActionDbClient({ call: async () => mockOfferSuccess() });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect(r.ok).toBe(true);
  });

  it("denies ai_service", async () => {
    const actionDb = createMockActionDbClient();
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg({ WAM_AI_INSTANCE_ACTOR_ROLE: "ai_service" }),
      db,
      actionDb,
      actor: aiActor,
    });
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe("action_not_authorized");
  });

  it("denies unknown role", async () => {
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg({ WAM_AI_INSTANCE_ACTOR_ROLE: "unknown" }),
      db,
      actionDb: createMockActionDbClient(),
      actor: unknownActor,
    });
    expect(r.error?.category).toBe("action_not_authorized");
  });

  it("denies unverified actor in production mode", async () => {
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "production",
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@db.example.com/postgres?sslmode=require",
      WAM_AI_ACTION_DATABASE_URL: "postgresql://wam_ai_business_actions:x@db.example.com/postgres?sslmode=require",
      WAM_AI_ACTIONS_ENABLED: "1",
      WAM_AI_INSTANCE_ID: "prod-gw",
      WAM_AI_INSTANCE_ACTOR_ID: "partner",
      WAM_AI_INSTANCE_ACTOR_ROLE: "business_partner",
    });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg,
      db,
      actionDb: createMockActionDbClient(),
      actor: { ...partnerActor, identityVerified: false },
    });
    expect(r.error?.category).toBe("action_not_authorized");
  });

  it("ignores prompt-supplied actor role in args", () => {
    expect(() =>
      parseActionArgs("create_lead_offer", {
        ...baseOfferArgs(),
        actor_role: "technical_owner",
        actor_id: "attacker",
      }),
    ).toThrow();
  });
});

describe("configuration", () => {
  it("actions disabled by default", () => {
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "development",
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    });
    expect(cfg.actionsEnabled).toBe(false);
    expect(listActionTools(cfg)).toEqual([]);
  });

  it("missing action database URL disables tool listing", () => {
    const cfg = devCfg({ WAM_AI_ACTION_DATABASE_URL: "" });
    expect(validateActionConfig(cfg).ok).toBe(false);
    expect(listActionTools(cfg)).toEqual([]);
  });

  it("incorrect database role disables tool listing", () => {
    const cfg = devCfg({
      WAM_AI_ACTION_DATABASE_URL: "postgresql://wrong_user:x@localhost/postgres",
    });
    expect(validateActionConfig(cfg).ok).toBe(false);
  });

  it("read-only config unaffected when actions disabled", () => {
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "development",
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
      WAM_AI_ACTIONS_ENABLED: "0",
    });
    expect(cfg.databaseUrl).toContain("wam_ai_business_readonly");
    expect(cfg.actionsEnabled).toBe(false);
  });

  it("action credential not exposed in output", async () => {
    const secretUrl = "postgresql://wam_ai_business_actions:secret@localhost/postgres";
    const cfg = devCfg({ WAM_AI_ACTION_DATABASE_URL: secretUrl });
    const actionDb = createMockActionDbClient({ call: async () => mockOfferSuccess() });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg,
      db,
      actionDb,
      actor: partnerActor,
    });
    const out = JSON.stringify(r);
    expect(out).not.toContain("secret");
    expect(out).not.toContain("postgresql://");
  });

  it("execute fails closed when actions disabled", async () => {
    const cfg = devCfg({ WAM_AI_ACTIONS_ENABLED: "0" });
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg,
      db: createMockDbClient(),
      actionDb: null,
      actor: partnerActor,
    });
    expect(r.error?.category).toBe("action_disabled");
  });

  it("same URL for read and action is rejected", () => {
    const url = "postgresql://wam_ai_business_readonly:x@localhost/postgres";
    const cfg = devCfg({
      WAM_AI_DATABASE_URL: url,
      WAM_AI_ACTION_DATABASE_URL: url,
    });
    expect(validateActionConfig(cfg).ok).toBe(false);
  });
});

describe("resolution validation", () => {
  it("accepts unique lead_id", () => {
    const p = parseActionArgs("create_lead_offer", baseOfferArgs());
    expect(p.lead_id).toBe(LEAD_ID);
  });

  it("accepts unique lead_ref", () => {
    const p = parseActionArgs("create_lead_offer", {
      ...baseOfferArgs(),
      lead_id: undefined,
      lead_ref: "L-77777777",
    });
    expect(p.lead_ref).toBe("L-77777777");
  });

  it("requires at least one lead identifier", () => {
    expect(() =>
      parseActionArgs("create_lead_offer", {
        ...baseOfferArgs(),
        lead_id: undefined,
      }),
    ).toThrow();
  });

  it("accepts unique agent_id", () => {
    expect(parseActionArgs("create_lead_offer", baseOfferArgs()).agent_id).toBe(AGENT_ID);
  });

  it("accepts agent_business_id", () => {
    const p = parseActionArgs("create_lead_offer", {
      ...baseOfferArgs(),
      agent_id: undefined,
      agent_business_id: AGENT_BIZ,
    });
    expect(p.agent_business_id).toBe(AGENT_BIZ);
  });

  it("requires at least one agent identifier", () => {
    expect(() =>
      parseActionArgs("create_lead_offer", {
        ...baseOfferArgs(),
        agent_id: undefined,
      }),
    ).toThrow();
  });

  it("rejects agent_name field", () => {
    expect(() =>
      parseActionArgs("create_lead_offer", {
        ...baseOfferArgs(),
        agent_name: "Bonface",
      }),
    ).toThrow();
  });

  it("requires explicit_action_authorized true", () => {
    expect(() =>
      parseActionArgs("create_lead_offer", {
        ...baseOfferArgs(),
        explicit_action_authorized: false,
      }),
    ).toThrow();
  });

  it("requires idempotency_key", () => {
    expect(() =>
      parseActionArgs("create_lead_offer", {
        ...baseOfferArgs(),
        idempotency_key: undefined,
      }),
    ).toThrow();
  });
});

describe("revalidation RPC outcomes", () => {
  beforeEach(() => resetRateLimitState());

  async function runWithPayload(payload: Record<string, unknown>) {
    const actionDb = createMockActionDbClient({ call: async () => payload });
    const db = createMockDbClient();
    return executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
  }

  it("maps lead_already_assigned", async () => {
    const r = await runWithPayload({
      status: "error",
      error_category: "lead_already_assigned",
      message: "Lead is already assigned",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe("lead_already_assigned");
  });

  it("maps active_offer_exists", async () => {
    const r = await runWithPayload({
      status: "error",
      error_category: "active_offer_exists",
    });
    expect(r.error?.category).toBe("active_offer_exists");
  });

  it("maps lead_state_changed", async () => {
    const r = await runWithPayload({
      status: "error",
      error_category: "lead_state_changed",
    });
    expect(r.error?.category).toBe("lead_state_changed");
  });

  it("maps agent_unavailable", async () => {
    const r = await runWithPayload({ status: "error", error_category: "agent_unavailable" });
    expect(r.error?.category).toBe("agent_unavailable");
  });

  it("maps agent_ineligible", async () => {
    const r = await runWithPayload({ status: "error", error_category: "agent_ineligible" });
    expect(r.error?.category).toBe("agent_ineligible");
  });

  it("maps capacity_reached", async () => {
    const r = await runWithPayload({ status: "error", error_category: "capacity_reached" });
    expect(r.error?.category).toBe("capacity_reached");
  });

  it("maps ambiguous_match", async () => {
    const r = await runWithPayload({ status: "ambiguous", error_category: "ambiguous_match" });
    expect(r.error?.category).toBe("ambiguous_match");
  });

  it("maps stale_recommendation", async () => {
    const r = await runWithPayload({ status: "error", error_category: "stale_recommendation" });
    expect(r.error?.category).toBe("stale_recommendation");
  });

  it("success includes agent_has_not_accepted", async () => {
    const r = await runWithPayload(mockOfferSuccess());
    expect(r.ok).toBe(true);
    expect((r.data as Record<string, unknown>).agent_has_not_accepted).toBe(true);
  });

  it("success discloses radius_exception_used", async () => {
    const r = await runWithPayload(mockOfferSuccess({ radius_exception_used: true, distance_km: 12 }));
    expect((r.data as Record<string, unknown>).radius_exception_used).toBe(true);
  });

  it("missing coordinates remain null not zero", async () => {
    const r = await runWithPayload(mockOfferSuccess({ distance_km: null }));
    expect((r.data as Record<string, unknown>).distance_km).toBeNull();
  });
});

describe("execution and idempotency", () => {
  beforeEach(() => resetRateLimitState());

  it("creates legitimate offer via action RPC", async () => {
    const actionDb = createMockActionDbClient({ call: async () => mockOfferSuccess() });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect(r.ok).toBe(true);
    expect((r.data as Record<string, unknown>).offer_status).toBe("offered");
    expect(actionDb.callCount).toBe(1);
  });

  it("returns idempotent replay", async () => {
    const actionDb = createMockActionDbClient({
      call: async () => mockOfferSuccess({ idempotent_replay: true }),
    });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect((r.data as Record<string, unknown>).idempotent_replay).toBe(true);
  });

  it("maps idempotency_conflict", async () => {
    const actionDb = createMockActionDbClient({
      call: async () => ({ status: "error", error_category: "idempotency_conflict" }),
    });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect(r.error?.category).toBe("idempotency_conflict");
  });

  it("passes actor from config not args to RPC", async () => {
    let captured: unknown[] = [];
    const actionDb = createMockActionDbClient({
      call: async (_fn, args) => {
        captured = args;
        return mockOfferSuccess();
      },
    });
    const db = createMockDbClient();
    await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect(captured[6]).toBe(partnerActor.actorId);
    expect(captured[7]).toBe(partnerActor.actorRole);
  });
});

describe("auditing and privacy", () => {
  beforeEach(() => resetRateLimitState());

  it("creates pre-call and completion audit", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({ call: async () => mockOfferSuccess() });
    await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect(db.audits.filter((a) => a.outcome === "failure")).toHaveLength(1);
    expect(db.audits.filter((a) => a.outcome === "success")).toHaveLength(1);
  });

  it("audits failed action", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({
      call: async () => ({ status: "error", error_category: "agent_unavailable" }),
    });
    await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect(db.audits.some((a) => a.errorCategory === "agent_unavailable")).toBe(true);
  });

  it("redacts params in audit hash", () => {
    const args = baseOfferArgs({ instruction_summary: "Offer to agent" });
    const redacted = redactParams(args);
    expect(redacted).not.toHaveProperty("agent_name");
    expect(hashParams(args)).toBeTruthy();
  });

  it("response includes offer_ref and audit reference", async () => {
    const actionDb = createMockActionDbClient({ call: async () => mockOfferSuccess() });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect((r.data as Record<string, unknown>).offer_ref).toBeTruthy();
    expect(r.auditId).toBeTruthy();
  });

  it("denied roles list excludes action-capable roles from openbook only", () => {
    const denied = ALLOWED_ACTOR_ROLES.filter((r) => !OPENBOOK_ALLOWED_ROLES.includes(r));
    expect(denied).toContain("ai_service");
    expect(denied).toContain("system_maintenance");
  });
});

describe("idempotency actor ownership", () => {
  it("maps idempotency_conflict for different actor semantics in message", async () => {
    const actionDb = createMockActionDbClient({
      call: async () => ({
        status: "error",
        error_category: "idempotency_conflict",
        message: "Idempotency key reused with different actor, lead, or agent",
      }),
    });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect(r.error?.category).toBe("idempotency_conflict");
  });
});

describe("county integrity (documented behavior)", () => {
  it("success payload may include agentOperatingCounty separately from customer county", async () => {
    const actionDb = createMockActionDbClient({
      call: async () =>
        mockOfferSuccess({
          lead_county: null,
          preview: { county: null, agentOperatingCounty: "Nakuru" },
        }),
    });
    const db = createMockDbClient();
    const r = await executeActionTool({
      tool: "create_lead_offer",
      args: baseOfferArgs({ agent_id: "33333333-3333-3333-3333-333333333333" }),
      cfg: devCfg(),
      db,
      actionDb,
      actor: partnerActor,
    });
    expect(r.ok).toBe(true);
  });
});

describe("regression", () => {
  it("recommendation tool namespace remains dispatch not action", () => {
    expect(parseAnyToolName("wam.business.dispatch.recommend_agents_for_lead")?.kind).toBe(
      "dispatch",
    );
  });

  it("action tool separate from recommendation", () => {
    expect(parseAnyToolName("wam.business.dispatch.create_lead_offer")?.kind).toBe("action");
  });
});
