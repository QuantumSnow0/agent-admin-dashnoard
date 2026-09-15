import { describe, expect, it, beforeEach } from "vitest";
import {
  ALLOWED_ACTOR_ROLES,
  loadConfig,
  OPENBOOK_ALLOWED_ROLES,
} from "../src/config.js";
import { createMockDbClient } from "../src/db.js";
import { assertNoPiiKeys } from "../src/redact.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { executeBusinessTool, listBusinessTools } from "../src/tools.js";
import {
  ValidationError,
  validateRequiredRange,
} from "../src/validation.js";

const partnerActor = {
  actorId: "unverified:partner",
  actorRole: "business_partner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

function devCfg(role = "business_partner") {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_INSTANCE_ACTOR_ROLE: role,
    WAM_AI_INSTANCE_ACTOR_ID: "test",
  });
}

/** Kenya Aug 28 2026 calendar day as UTC instants (EAT = UTC+3). */
const KENYA_DAY_FROM = "2026-08-27T21:00:00.000Z";
const KENYA_DAY_TO = "2026-08-28T20:59:59.999Z";

const sampleAggregate = {
  operation: "get_agent_registration_performance",
  range_from: KENYA_DAY_FROM,
  range_to: KENYA_DAY_TO,
  timezone_label: "Africa/Nairobi",
  total_registration_count: 3,
  unattributed_registration_count: 0,
  unknown_source_classification_count: 0,
  warnings: ["safaricom_registration_commission_not_estimated_in_sql"],
  metric_definitions: {
    self_generated_registrations:
      "Airtel with inbound_lead_id IS NULL plus all Safaricom registrations",
  },
  agents: [
    {
      agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      agent_business_id: "A-aaaaaaaa",
      agent_name: "Agent One",
      total_customer_registrations: 2,
      self_generated_registrations: 1,
      dispatched_lead_registrations: 1,
      airtel_registrations: 2,
      safaricom_registrations: 0,
      confirmed_installations: 1,
      pending_or_incomplete_registrations: 1,
      conversion_rate: 50,
      commission_earned_ksh: 500,
      dispatched_offers_accepted_in_range: 2,
    },
    {
      agent_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      agent_business_id: "A-dddddddd",
      agent_name: "Agent Two",
      total_customer_registrations: 1,
      self_generated_registrations: 1,
      dispatched_lead_registrations: 0,
      airtel_registrations: 0,
      safaricom_registrations: 1,
      confirmed_installations: 0,
      pending_or_incomplete_registrations: 1,
      conversion_rate: 0,
      commission_earned_ksh: 0,
      dispatched_offers_accepted_in_range: 0,
    },
  ],
  result_count: 2,
};

beforeEach(() => {
  resetRateLimitState();
});

describe("get_agent_registration_performance catalog", () => {
  it("is registered as the 11th analytics tool", () => {
    const names = listBusinessTools().map((t) => t.name);
    expect(names).toHaveLength(11);
    expect(names).toContain(
      "wam.business.analytics.get_agent_registration_performance",
    );
  });
});

describe("get_agent_registration_performance authorization", () => {
  it("allows technical_owner and business_partner", async () => {
    for (const role of OPENBOOK_ALLOWED_ROLES) {
      const db = createMockDbClient({
        call: async () => sampleAggregate,
      });
      const res = await executeBusinessTool({
        tool: "get_agent_registration_performance",
        args: { from: KENYA_DAY_FROM, to: KENYA_DAY_TO },
        cfg: devCfg(role),
        db,
        actor: { ...partnerActor, actorRole: role },
      });
      expect(res.ok).toBe(true);
    }
  });

  it.each(
    ALLOWED_ACTOR_ROLES.filter((r) => !OPENBOOK_ALLOWED_ROLES.includes(r)),
  )("denies role %s", async (role) => {
    const db = createMockDbClient();
    const res = await executeBusinessTool({
      tool: "get_agent_registration_performance",
      args: { from: KENYA_DAY_FROM, to: KENYA_DAY_TO },
      cfg: devCfg(role),
      db,
      actor: { ...partnerActor, actorRole: role },
    });
    expect(res.ok).toBe(false);
    expect(res.denied).toBe(true);
    expect(db.callCount).toBe(0);
    expect(db.audits.some((a) => a.errorCategory === "role_denied")).toBe(true);
  });
});

describe("get_agent_registration_performance validation", () => {
  it("requires from and to", async () => {
    const db = createMockDbClient();
    const res = await executeBusinessTool({
      tool: "get_agent_registration_performance",
      args: { from: KENYA_DAY_FROM },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("validation");
    expect(db.callCount).toBe(0);
  });

  it("rejects ranges over 90 days", () => {
    expect(() =>
      validateRequiredRange("2026-01-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z"),
    ).toThrow(ValidationError);
  });

  it("passes Kenya calendar-day UTC instants unchanged to SQL", async () => {
    const db = createMockDbClient({
      call: async (fn, args) => {
        expect(fn).toBe("get_agent_registration_performance");
        expect(args[0]).toBe(KENYA_DAY_FROM);
        expect(args[1]).toBe(KENYA_DAY_TO);
        return sampleAggregate;
      },
    });
    const res = await executeBusinessTool({
      tool: "get_agent_registration_performance",
      args: { from: KENYA_DAY_FROM, to: KENYA_DAY_TO, product: "airtel", limit: 25 },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects limit above 100", async () => {
    const db = createMockDbClient();
    const res = await executeBusinessTool({
      tool: "get_agent_registration_performance",
      args: { from: KENYA_DAY_FROM, to: KENYA_DAY_TO, limit: 101 },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(db.callCount).toBe(0);
  });
});

describe("get_agent_registration_performance semantics", () => {
  it("returns per-agent attribution with self vs dispatched separation", async () => {
    const db = createMockDbClient({ call: async () => sampleAggregate });
    const res = await executeBusinessTool({
      tool: "get_agent_registration_performance",
      args: { from: KENYA_DAY_FROM, to: KENYA_DAY_TO },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
    const agents = (res.data as { agents: Array<Record<string, unknown>> }).agents;
    const a1 = agents.find((a) => a.agent_name === "Agent One")!;
    expect(a1.self_generated_registrations).toBe(1);
    expect(a1.dispatched_lead_registrations).toBe(1);
    expect(a1.dispatched_offers_accepted_in_range).toBe(2);
    expect(a1.total_customer_registrations).toBe(2);
  });

  it("does not convert unknown conversion_rate to zero when denominator is zero", async () => {
    const payload = {
      ...sampleAggregate,
      agents: [
        {
          ...sampleAggregate.agents[0],
          total_customer_registrations: 0,
          confirmed_installations: 0,
          conversion_rate: null,
        },
      ],
    };
    const db = createMockDbClient({ call: async () => payload });
    const res = await executeBusinessTool({
      tool: "get_agent_registration_performance",
      args: { from: KENYA_DAY_FROM, to: KENYA_DAY_TO },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    const agent = (res.data as { agents: Array<Record<string, unknown>> }).agents[0];
    expect(agent.conversion_rate).toBeNull();
    expect(agent.total_customer_registrations).toBe(0);
  });

  it("surfaces unattributed and warning counts without masking as zero", async () => {
    const payload = {
      ...sampleAggregate,
      unattributed_registration_count: 2,
      unknown_source_classification_count: 1,
      warnings: ["airtel_registrations_reference_missing_inbound_lead"],
    };
    const db = createMockDbClient({ call: async () => payload });
    const res = await executeBusinessTool({
      tool: "get_agent_registration_performance",
      args: { from: KENYA_DAY_FROM, to: KENYA_DAY_TO },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    const data = res.data as {
      unattributed_registration_count: number;
      unknown_source_classification_count: number;
      warnings: string[];
    };
    expect(data.unattributed_registration_count).toBe(2);
    expect(data.unknown_source_classification_count).toBe(1);
    expect(data.warnings.length).toBeGreaterThan(0);
  });

  it("blocks customer PII in aggregate output", async () => {
    const piiPayload = {
      ...sampleAggregate,
      agents: [
        {
          ...sampleAggregate.agents[0],
          customer_name: "Jane",
          primary_phone: "254722",
        },
      ],
    };
    const db = createMockDbClient({ call: async () => piiPayload });
    const res = await executeBusinessTool({
      tool: "get_agent_registration_performance",
      args: { from: KENYA_DAY_FROM, to: KENYA_DAY_TO },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("pii_guard");
  });

  it("allows agent names without customer PII keys", () => {
    expect(
      assertNoPiiKeys({
        agents: [{ agent_name: "Agent One", total_customer_registrations: 2 }],
      }),
    ).toEqual([]);
  });
});

describe("get_agent_registration_performance audit", () => {
  it("writes pre-call and completion audits", async () => {
    const db = createMockDbClient({ call: async () => sampleAggregate });
    const res = await executeBusinessTool({
      tool: "get_agent_registration_performance",
      args: { from: KENYA_DAY_FROM, to: KENYA_DAY_TO },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
    expect(db.audits.length).toBeGreaterThanOrEqual(2);
    expect(db.audits[0]?.operationName).toBe("get_agent_registration_performance");
    expect(db.audits.some((a) => a.dataClassification === "safe_aggregate")).toBe(true);
  });
});
