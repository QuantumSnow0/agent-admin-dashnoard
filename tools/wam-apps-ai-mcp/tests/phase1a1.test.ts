import { describe, expect, it, beforeEach } from "vitest";
import {
  ALLOWED_ACTOR_ROLES,
  loadConfig,
  OPENBOOK_ALLOWED_ROLES,
} from "../src/config.js";
import { createMockDbClient } from "../src/db.js";
import {
  assertOpenBookOutputAllowed,
  containsHighlySensitive,
  redactAuditParams,
} from "../src/privacy.js";
import { hashParams, redactParams } from "../src/redact.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { parseAnyToolName } from "../src/server.js";
import { listBusinessTools } from "../src/tools.js";
import {
  executeOperationsTool,
  listOperationsTools,
  parseOperationsToolName,
} from "../src/tools-operations.js";
import {
  OPERATIONS_TOOL_NAMES,
  OPERATIONS_TOOL_SCHEMAS,
} from "../src/validation-operations.js";

const partnerActor = {
  actorId: "unverified:partner",
  actorRole: "business_partner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

const ownerActor = {
  ...partnerActor,
  actorId: "unverified:owner",
  actorRole: "technical_owner" as const,
};

function devCfg(extra: Record<string, string> = {}) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "partner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "business_partner",
    ...extra,
  });
}

function cfgForRole(role: string) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_INSTANCE_ACTOR_ROLE: role,
    WAM_AI_INSTANCE_ACTOR_ID: "test",
  });
}

const DENIED_ROLES = ALLOWED_ACTOR_ROLES.filter(
  (r) => !OPENBOOK_ALLOWED_ROLES.includes(r),
);

const SEARCH_TOOLS = [
  "search_agents",
  "search_leads",
  "search_customers",
] as const;

const DETAIL_TOOLS = [
  "get_agent_details",
  "get_lead_details",
  "get_customer_details",
] as const;

const MINIMAL_ARGS: Record<string, Record<string, unknown>> = {
  search_agents: { name: "Test" },
  get_agent_details: { agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
  search_leads: { county: "Nairobi" },
  get_lead_details: { lead_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
  search_customers: { name: "Jane" },
  get_customer_details: {
    record_type: "inbound_lead",
    record_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  },
};

beforeEach(() => {
  resetRateLimitState();
});

describe("Phase 1A.1 tool catalog", () => {
  it("keeps eleven analytics tools and adds six operations tools", () => {
    expect(listBusinessTools()).toHaveLength(11);
    expect(listOperationsTools()).toHaveLength(6);
    expect(OPERATIONS_TOOL_NAMES).toHaveLength(6);
  });

  it("parses operations namespace", () => {
    expect(parseOperationsToolName("wam.business.operations.search_leads")).toBe(
      "search_leads",
    );
    expect(parseAnyToolName("wam.business.operations.get_lead_details")?.kind).toBe(
      "operations",
    );
  });

  it("advertises strict schemas for operations tools", () => {
    for (const name of OPERATIONS_TOOL_NAMES) {
      expect(OPERATIONS_TOOL_SCHEMAS[name].additionalProperties).toBe(false);
    }
  });
});

describe("Phase 1A.1 authorization", () => {
  it("allows technical_owner", async () => {
    const db = createMockDbClient({
      call: async () => ({ operation: "search_agents", result_count: 0, agents: [] }),
    });
    const res = await executeOperationsTool({
      tool: "search_agents",
      args: { name: "Test" },
      cfg: cfgForRole("technical_owner"),
      db,
      actor: ownerActor,
    });
    expect(res.ok).toBe(true);
    expect(db.callCount).toBe(1);
  });

  it("allows business_partner", async () => {
    const db = createMockDbClient({
      call: async () => ({ operation: "search_agents", result_count: 0, agents: [] }),
    });
    const res = await executeOperationsTool({
      tool: "search_agents",
      args: { name: "Test" },
      cfg: cfgForRole("business_partner"),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
    expect(db.callCount).toBe(1);
  });

  it.each(DENIED_ROLES)("denies role %s", async (role) => {
    const db = createMockDbClient();
    const res = await executeOperationsTool({
      tool: "search_agents",
      args: { name: "Test" },
      cfg: cfgForRole(role),
      db,
      actor: { ...partnerActor, actorRole: role },
    });
    expect(res.ok).toBe(false);
    expect(res.denied).toBe(true);
    expect(res.error?.category).toBe("denied");
    expect(db.callCount).toBe(0);
    expect(db.audits.some((a) => a.errorCategory === "role_denied")).toBe(true);
  });
});

describe("Phase 1A.1 search limits and empty searches", () => {
  it.each(SEARCH_TOOLS)("rejects empty search for %s", async (tool) => {
    const db = createMockDbClient();
    const res = await executeOperationsTool({
      tool,
      args: {},
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("validation");
    expect(db.callCount).toBe(0);
  });

  it("rejects limit above 100", async () => {
    const db = createMockDbClient();
    const res = await executeOperationsTool({
      tool: "search_customers",
      args: { name: "Jane", limit: 101 },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(db.callCount).toBe(0);
  });

  it("rejects limit below 1", async () => {
    const db = createMockDbClient();
    const res = await executeOperationsTool({
      tool: "search_agents",
      args: { name: "Test", limit: 0 },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(db.callCount).toBe(0);
  });

  it("passes valid limit to SQL (max 100)", async () => {
    const db = createMockDbClient({
      call: async (fn, args) => {
        expect(fn).toBe("search_leads");
        expect(args[9]).toBe(100);
        return { operation: "search_leads", limit: 100, result_count: 0, leads: [] };
      },
    });
    const res = await executeOperationsTool({
      tool: "search_leads",
      args: { county: "Nairobi", limit: 100 },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
  });

  it("passes null limit when omitted (DB default 25)", async () => {
    const db = createMockDbClient({
      call: async (_fn, args) => {
        expect(args[args.length - 1]).toBeNull();
        return { operation: "search_agents", limit: 25, result_count: 0, agents: [] };
      },
    });
    const res = await executeOperationsTool({
      tool: "search_agents",
      args: { name: "Test" },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
  });
});

describe("Phase 1A.1 audit redaction", () => {
  it("redacts names, phones, emails and national IDs in audit params", () => {
    const r = redactParams({
      name: "Jane Doe",
      customer_name: "Jane Doe",
      phone: "254711000001",
      primary_phone: "254722000002",
      alternate_phone: "254733000003",
      email: "jane@test.local",
      national_id: "12345678",
      lead_ref: "L-abc123",
      business_ref: "CR-abc12345",
      record_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      agent_business_id: "A-aaaaaaaa",
      county: "Nairobi",
      status: "assigned",
    });
    expect(r.name).toBe("[REDACTED]");
    expect(r.customer_name).toBe("[REDACTED]");
    expect(r.phone).toBe("[REDACTED]");
    expect(r.primary_phone).toBe("[REDACTED]");
    expect(r.alternate_phone).toBe("[REDACTED]");
    expect(r.email).toBe("[REDACTED]");
    expect(r.national_id).toBe("[REDACTED]");
    expect(r.lead_ref).toBe("[REDACTED]");
    expect(r.business_ref).toBe("[REDACTED]");
    expect(r.record_id).toBe("[REDACTED]");
    expect(r.agent_business_id).toBe("[REDACTED]");
    expect(r.county).toBe("Nairobi");
    expect(r.status).toBe("assigned");
  });

  it("redacts SR/IMEI keys in audit params", () => {
    const r = redactAuditParams({
      airtel_sr_number: "SR-123",
      safaricom_imei: "IMEI-456",
    });
    expect(r.airtel_sr_number).toBe("[REDACTED]");
    expect(r.safaricom_imei).toBe("[REDACTED]");
  });

  it("hashes redacted params without raw PII", () => {
    const h = hashParams({ phone: "254711", name: "Jane" });
    expect(h).toHaveLength(32);
    expect(h).not.toContain("254711");
    expect(h).not.toContain("Jane");
  });
});

describe("Phase 1A.1 audit records for all operations tools", () => {
  it.each(OPERATIONS_TOOL_NAMES)(
    "%s writes pre-call and completion audit records",
    async (tool) => {
      const db = createMockDbClient({
        call: async () => {
          if (tool.startsWith("get_")) {
            return { status: "success", match_count: 1, agent: { name: "A" } };
          }
          return { operation: tool, result_count: 0, agents: [], leads: [], customers: [] };
        },
      });
      const res = await executeOperationsTool({
        tool,
        args: MINIMAL_ARGS[tool],
        cfg: devCfg(),
        db,
        actor: partnerActor,
      });
      expect(res.ok).toBe(true);
      expect(res.auditId).toBeTruthy();
      expect(db.audits.length).toBeGreaterThanOrEqual(2);
      const correlationIds = new Set(db.audits.map((a) => a.correlationId));
      expect(correlationIds.size).toBe(1);
      expect(db.audits[0]?.errorCategory).toBe("pending_execution");
      expect(db.audits.some((a) => a.outcome === "success")).toBe(true);
    },
  );
});

describe("Phase 1A.1 exact-record detail lookups", () => {
  it.each(DETAIL_TOOLS)("%s succeeds only for single resolved record", async (tool) => {
    const db = createMockDbClient({
      call: async () => ({
        status: "success",
        match_count: 1,
        agent: { agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Agent" },
        lead: { lead_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", customer_name: "Jane" },
        customer: { record_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", customer_name: "Jane" },
      }),
    });
    const res = await executeOperationsTool({
      tool,
      args: MINIMAL_ARGS[tool],
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
    const data = res.data as { match_count: number; status: string };
    expect(data.match_count).toBe(1);
    expect(data.status).toBe("success");
  });

  it("returns ambiguous_match when multiple records match", async () => {
    const db = createMockDbClient({
      call: async () => ({
        status: "ambiguous",
        match_count: 2,
        message: "Multiple leads match phone",
      }),
    });
    const res = await executeOperationsTool({
      tool: "get_lead_details",
      args: { primary_phone: "254722000002" },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("ambiguous_match");
  });

  it("returns ambiguous_match for conflicting identifiers from DB", async () => {
    const db = createMockDbClient({
      call: async () => ({
        status: "ambiguous",
        match_count: 2,
        message: "primary_phone does not match other supplied identifiers",
      }),
    });
    const res = await executeOperationsTool({
      tool: "get_lead_details",
      args: {
        lead_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        primary_phone: "254799999999",
      },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("ambiguous_match");
  });

  it("returns ambiguous_match for conflicting customer identifiers", async () => {
    const db = createMockDbClient({
      call: async () => ({
        status: "ambiguous",
        match_count: 2,
        message: "email does not match other supplied identifiers",
      }),
    });
    const res = await executeOperationsTool({
      tool: "get_customer_details",
      args: {
        record_type: "inbound_lead",
        record_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        email: "wrong@test.local",
      },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("ambiguous_match");
  });
});

describe("Phase 1A.1 forbidden output keys", () => {
  const forbiddenPayloads = [
    { otp: "123456" },
    { password: "secret" },
    { access_token: "tok" },
    { refresh_token: "tok" },
    { api_key: "key" },
    { service_role: "sr" },
    { device_token: "dt" },
    { kill_switch: true },
    { is_super_admin: true },
    { dedupe_phone_key: "x" },
    { preview_payload: {} },
    { metadata: { secret: true } },
    { ms_forms_response_id: "ms-1" },
  ];

  it.each(forbiddenPayloads)(
    "blocks forbidden key in operations output: %j",
    (payload) => {
      const hits = assertOpenBookOutputAllowed("get_lead_details", {
        status: "success",
        lead: payload,
      });
      expect(hits.length).toBeGreaterThan(0);
    },
  );

  it("blocks SR/IMEI in search results", () => {
    expect(
      assertOpenBookOutputAllowed("search_leads", {
        leads: [{ lead_ref: "L-1", airtel_sr_number: "SR-1" }],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      assertOpenBookOutputAllowed("search_leads", {
        leads: [{ lead_ref: "L-1", safaricom_imei: "IMEI-1" }],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      assertOpenBookOutputAllowed("search_customers", {
        customers: [{ business_ref: "CR-1", safaricom_imei: "IMEI-1" }],
      }).length,
    ).toBeGreaterThan(0);
  });

  it("allows SR/IMEI in detail lookup only", () => {
    expect(
      assertOpenBookOutputAllowed("get_lead_details", {
        status: "success",
        lead: {
          airtel_sr_number: "SR-TEST-001",
          safaricom_imei: "IMEI-TEST-001",
          customer_name: "Jane",
        },
      }),
    ).toEqual([]);
    expect(
      assertOpenBookOutputAllowed("get_customer_details", {
        status: "success",
        customer: { airtel_sr_number: "SR-1", safaricom_imei: "IMEI-1" },
      }),
    ).toEqual([]);
  });

  it("classifies national_id as highly_sensitive", () => {
    expect(containsHighlySensitive({ lead: { national_id: "12345678" } })).toBe(true);
    expect(containsHighlySensitive({ lead: { airtel_sr_number: "SR-1" } })).toBe(false);
  });
});

describe("Phase 1A.1 analytics regression", () => {
  it("does not expose operations tools under analytics namespace", () => {
    const analytics = listBusinessTools().map((t) => t.name);
    expect(analytics.some((n) => n.includes("search_agents"))).toBe(false);
    expect(analytics.every((n) => n.startsWith("wam.business.analytics."))).toBe(true);
  });
});
