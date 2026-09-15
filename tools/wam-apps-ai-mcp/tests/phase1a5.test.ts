import { describe, expect, it, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { createMockActionDbClient, isAllowedActionFn } from "../src/actionDb.js";
import { createMockDbClient } from "../src/db.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { listActionTools, executeActionTool } from "../src/tools-actions.js";
import {
  ACTION_TOOL_SQL_FN,
  parseActionArgs,
  zodActionPropertyKeys,
  jsonSchemaPropertyKeys,
  fullActionToolName,
} from "../src/validation-actions.js";

const PHASE1A5_TOOLS = [
  "mark_lead_kyc_completed",
  "mark_lead_pending_install",
  "expire_lead_offer",
  "set_agent_pending",
  "set_agent_fallback_dispatch",
  "set_agent_service_radius",
  "reopen_airtel_registration_pending",
  "reopen_safaricom_registration_pending",
] as const;

const BUSINESS_GATEWAY_AGENT_CONFIG = [
  "set_agent_fallback_dispatch",
  "set_agent_service_radius",
] as const;

function devCfg(extra: Record<string, string> = {}) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_ACTION_DATABASE_URL: "postgresql://wam_ai_business_actions:x@localhost/postgres",
    WAM_AI_ACTIONS_ENABLED: "1",
    WAM_AI_LEAD_PIPELINE_ACTIONS_ENABLED: "1",
    WAM_AI_DISPATCH_OPS_ACTIONS_ENABLED: "1",
    WAM_AI_AGENT_CONFIG_ACTIONS_ENABLED: "1",
    WAM_AI_REGISTRATION_REOPEN_ACTIONS_ENABLED: "1",
    WAM_AI_FINANCIAL_ACTIONS_ENABLED: "0",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "owner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
    ...extra,
  });
}

const ownerActor = {
  actorId: "unverified:owner",
  actorRole: "technical_owner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

const partnerActor = {
  ...ownerActor,
  actorId: "unverified:partner",
  actorRole: "business_partner" as const,
};

describe("Phase 1A.5 operational actions", () => {
  beforeEach(() => resetRateLimitState());

  it("lists Phase 1A.5 tools only when category kill switches enabled", () => {
    const off = listActionTools(devCfg({ WAM_AI_LEAD_PIPELINE_ACTIONS_ENABLED: "0" }));
    for (const t of ["mark_lead_kyc_completed", "mark_lead_pending_install"] as const) {
      expect(off.map((x) => x.name)).not.toContain(fullActionToolName(t));
    }
    const on = listActionTools(devCfg());
    for (const t of PHASE1A5_TOOLS) {
      expect(on.map((x) => x.name)).toContain(fullActionToolName(t));
    }
  });

  it("registers all Phase 1A.5 SQL functions in action allowlist", () => {
    for (const t of PHASE1A5_TOOLS) {
      expect(isAllowedActionFn(ACTION_TOOL_SQL_FN[t])).toBe(true);
    }
  });

  it("mark_lead_pending_install stays non-financial in catalog with financial actions disabled", () => {
    const cfg = devCfg({ WAM_AI_FINANCIAL_ACTIONS_ENABLED: "0" });
    const tools = listActionTools(cfg);
    expect(tools.map((t) => t.name)).toContain(fullActionToolName("mark_lead_pending_install"));
  });

  it("validates expire_lead_offer offer_reference pattern", () => {
    expect(() =>
      parseActionArgs("expire_lead_offer", {
        ...minimalArgs("expire_lead_offer"),
        offer_id: undefined,
        offer_reference: "not-valid",
      }),
    ).toThrow();
  });

  it("requires explicit_action_authorized for mark_lead_kyc_completed", async () => {
    const cfg = devCfg();
    const db = createMockDbClient({ recordAudit: async () => ({ ok: true, id: "a1" }) });
    const actionDb = createMockActionDbClient();
    const res = await executeActionTool({
      tool: "mark_lead_kyc_completed",
      args: { ...minimalArgs("mark_lead_kyc_completed"), explicit_action_authorized: false },
      cfg,
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("validation");
  });

  it("denies ai_service role", async () => {
    const cfg = devCfg();
    const db = createMockDbClient({ recordAudit: async () => ({ ok: true, id: "a1" }) });
    const actionDb = createMockActionDbClient();
    const res = await executeActionTool({
      tool: "expire_lead_offer",
      args: minimalArgs("expire_lead_offer"),
      cfg,
      db,
      actionDb,
      actor: { ...ownerActor, actorRole: "ai_service" },
    });
    expect(res.denied).toBe(true);
  });

  for (const tool of BUSINESS_GATEWAY_AGENT_CONFIG) {
    it(`allows business_partner for agent-config action ${tool}`, async () => {
      const cfg = devCfg();
      const db = createMockDbClient({ recordAudit: async () => ({ ok: true, id: "a1" }) });
      const actionDb = createMockActionDbClient({
        call: async () => ({
          status: "success",
          operation: tool,
          changed: true,
        }),
      });
      const res = await executeActionTool({
        tool,
        args: minimalArgs(tool),
        cfg,
        db,
        actionDb,
        actor: partnerActor,
      });
      expect(res.denied).not.toBe(true);
      expect(res.ok).toBe(true);
    });
  }

  for (const tool of BUSINESS_GATEWAY_AGENT_CONFIG) {
    it(`denies ai_service for agent-config action ${tool}`, async () => {
      const cfg = devCfg();
      const db = createMockDbClient({ recordAudit: async () => ({ ok: true, id: "a1" }) });
      const actionDb = createMockActionDbClient();
      const res = await executeActionTool({
        tool,
        args: minimalArgs(tool),
        cfg,
        db,
        actionDb,
        actor: { ...ownerActor, actorRole: "ai_service" },
      });
      expect(res.denied).toBe(true);
    });
  }

  for (const tool of BUSINESS_GATEWAY_AGENT_CONFIG) {
    it(`allows technical_owner for agent-config action ${tool}`, async () => {
      const cfg = devCfg();
      const db = createMockDbClient({ recordAudit: async () => ({ ok: true, id: "a1" }) });
      const actionDb = createMockActionDbClient({
        call: async () => ({
          status: "success",
          operation: tool,
          changed: true,
        }),
      });
      const res = await executeActionTool({
        tool,
        args: minimalArgs(tool),
        cfg,
        db,
        actionDb,
        actor: ownerActor,
      });
      expect(res.denied).not.toBe(true);
      expect(res.ok).toBe(true);
    });
  }

  it("allows business_partner for operational set_agent_pending", async () => {
    const cfg = devCfg();
    const db = createMockDbClient({ recordAudit: async () => ({ ok: true, id: "a1" }) });
    const actionDb = createMockActionDbClient({
      call: async () => ({
        status: "success",
        operation: "set_agent_pending",
        resulting_agent_status: "pending",
      }),
    });
    const res = await executeActionTool({
      tool: "set_agent_pending",
      args: minimalArgs("set_agent_pending"),
      cfg,
      db,
      actionDb,
      actor: partnerActor,
    });
    expect(res.denied).not.toBe(true);
    expect(res.ok).toBe(true);
  });

  it("surfaces SQL commission_present from mark_lead_pending_install", async () => {
    const cfg = devCfg();
    const db = createMockDbClient({ recordAudit: async () => ({ ok: true, id: "a1" }) });
    const actionDb = createMockActionDbClient({
      call: async () => ({
        status: "error",
        error_category: "commission_present",
        operation: "mark_lead_pending_install",
        message: "Lead has financial state",
      }),
    });
    const res = await executeActionTool({
      tool: "mark_lead_pending_install",
      args: minimalArgs("mark_lead_pending_install"),
      cfg,
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("commission_present");
  });

  it("lead pipeline kill switch does not bypass financial refusal at MCP layer", async () => {
    const cfg = devCfg({ WAM_AI_FINANCIAL_ACTIONS_ENABLED: "0" });
    const db = createMockDbClient({ recordAudit: async () => ({ ok: true, id: "a1" }) });
    const actionDb = createMockActionDbClient({
      call: async () => ({
        status: "error",
        error_category: "commission_present",
        operation: "mark_lead_pending_install",
      }),
    });
    const res = await executeActionTool({
      tool: "mark_lead_pending_install",
      args: minimalArgs("mark_lead_pending_install"),
      cfg,
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(res.error?.category).toBe("commission_present");
  });
});

describe("Phase 1A.5 schema parity", () => {
  for (const tool of PHASE1A5_TOOLS) {
    it(`${tool} Zod/JSON Schema property keys match`, () => {
      expect(zodActionPropertyKeys(tool)).toEqual(jsonSchemaPropertyKeys(tool));
    });
  }
});

function minimalArgs(tool: (typeof PHASE1A5_TOOLS)[number]): Record<string, unknown> {
  const core = {
    idempotency_key: "11111111-1111-1111-1111-111111111111",
    explicit_action_authorized: true as const,
    instruction_summary: "test action",
  };
  switch (tool) {
    case "mark_lead_kyc_completed":
    case "mark_lead_pending_install":
      return { ...core, lead_id: "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4", expected_lead_status: "assigned" };
    case "expire_lead_offer":
      return { ...core, offer_id: "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3", expected_offer_status: "offered" };
    case "set_agent_pending":
      return { ...core, agent_id: "44444444-4444-4444-4444-444444444444", expected_agent_status: "approved" };
    case "set_agent_fallback_dispatch":
      return { ...core, agent_id: "11111111-1111-1111-1111-111111111111", is_fallback_agent: true };
    case "set_agent_service_radius":
      return { ...core, agent_id: "22222222-2222-2222-2222-222222222222", service_radius_km: 10 };
    case "reopen_airtel_registration_pending":
    case "reopen_safaricom_registration_pending":
      return {
        ...core,
        registration_id: "a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5",
        expected_registration_status: "rejected",
      };
  }
}
