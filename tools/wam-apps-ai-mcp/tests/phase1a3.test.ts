import { describe, expect, it, beforeEach } from "vitest";
import {
  loadConfig,
  isActionCategoryEnabled,
} from "../src/config.js";
import { createMockActionDbClient } from "../src/actionDb.js";
import { createMockDbClient } from "../src/db.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { parseAnyToolName } from "../src/server.js";
import {
  executeActionTool,
  listActionTools,
  parseActionToolName,
} from "../src/tools-actions.js";
import {
  ACTION_TOOL_NAMES,
  ACTION_TOOL_FINANCIAL,
  type ActionToolName,
  fullActionToolName,
  parseActionArgs,
} from "../src/validation-actions.js";

const PENDING_AGENT = "55555555-5555-5555-5555-555555555555";
const LEAD_INSTALL = "99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LEAD_INSTALLED = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";
const REG_AIRTEL = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const IDEM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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
const aiActor = { ...partnerActor, actorRole: "ai_service" as const };

function devCfg(extra: Record<string, string> = {}) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_ACTION_DATABASE_URL: "postgresql://wam_ai_business_actions:x@localhost/postgres",
    WAM_AI_ACTIONS_ENABLED: "1",
    WAM_AI_FINANCIAL_ACTIONS_ENABLED: "1",
    WAM_AI_LEAD_PIPELINE_ACTIONS_ENABLED: "1",
    WAM_AI_DISPATCH_OPS_ACTIONS_ENABLED: "1",
    WAM_AI_AGENT_CONFIG_ACTIONS_ENABLED: "1",
    WAM_AI_REGISTRATION_REOPEN_ACTIONS_ENABLED: "1",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "partner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "business_partner",
    ...extra,
  });
}

function actionCore(summary: string, idempotencyKey = IDEM) {
  return {
    idempotency_key: idempotencyKey,
    explicit_action_authorized: true as const,
    instruction_summary: summary,
  };
}

type ExpectedField =
  | "expected_agent_status"
  | "expected_dispatch_scope"
  | "expected_registration_status"
  | "expected_lead_status"
  | "expected_offer_status";

const EXPECTED_FIELD: Partial<Record<ActionToolName, ExpectedField>> = {
  approve_agent: "expected_agent_status",
  reject_agent: "expected_agent_status",
  ban_agent: "expected_agent_status",
  restore_agent: "expected_agent_status",
  change_dispatch_scope: "expected_dispatch_scope",
  reject_airtel_registration: "expected_registration_status",
  mark_airtel_registration_duplicate: "expected_registration_status",
  cancel_airtel_registration: "expected_registration_status",
  confirm_airtel_installation: "expected_registration_status",
  reject_safaricom_registration: "expected_registration_status",
  mark_safaricom_registration_duplicate: "expected_registration_status",
  cancel_safaricom_registration: "expected_registration_status",
  confirm_safaricom_installation: "expected_registration_status",
  confirm_lead_installation: "expected_lead_status",
  mark_lead_rejected: "expected_lead_status",
  mark_lead_duplicate: "expected_lead_status",
  mark_lead_cancelled: "expected_lead_status",
  mark_lead_lost: "expected_lead_status",
  mark_lead_needs_reassignment: "expected_lead_status",
  revert_lead_pending_install: "expected_lead_status",
  mark_lead_kyc_completed: "expected_lead_status",
  mark_lead_pending_install: "expected_lead_status",
  expire_lead_offer: "expected_offer_status",
  set_agent_pending: "expected_agent_status",
  reopen_airtel_registration_pending: "expected_registration_status",
  reopen_safaricom_registration_pending: "expected_registration_status",
};

function minimalArgs(tool: ActionToolName): Record<string, unknown> {
  const core = actionCore(`${tool} contract`);
  switch (tool) {
    case "create_lead_offer":
      return {
        ...core,
        lead_id: "77777777-7777-7777-7777-777777777777",
        agent_id: PENDING_AGENT,
      };
    case "change_dispatch_scope":
      return { ...core, agent_id: PENDING_AGENT, dispatch_scope: "airtel", expected_dispatch_scope: "both" };
    case "approve_agent":
    case "reject_agent":
    case "ban_agent":
    case "restore_agent":
      return { ...core, agent_id: PENDING_AGENT, expected_agent_status: "pending" };
    case "reject_airtel_registration":
    case "mark_airtel_registration_duplicate":
    case "cancel_airtel_registration":
    case "confirm_airtel_installation":
      return { ...core, registration_id: REG_AIRTEL, expected_registration_status: "pending" };
    case "reject_safaricom_registration":
    case "mark_safaricom_registration_duplicate":
    case "cancel_safaricom_registration":
    case "confirm_safaricom_installation":
      return {
        ...core,
        registration_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        expected_registration_status: "pending",
      };
    case "confirm_lead_installation":
      return { ...core, lead_id: LEAD_INSTALL, expected_lead_status: "pending_install" };
    case "mark_lead_rejected":
    case "mark_lead_duplicate":
    case "mark_lead_cancelled":
    case "mark_lead_lost":
    case "mark_lead_needs_reassignment":
      return {
        ...core,
        lead_id: "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4",
        expected_lead_status: "assigned",
      };
    case "revert_lead_pending_install":
      return { ...core, lead_id: LEAD_INSTALLED, expected_lead_status: "installed" };
    case "mark_lead_kyc_completed":
    case "mark_lead_pending_install":
      return {
        ...core,
        lead_id: "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4",
        expected_lead_status: "assigned",
      };
    case "expire_lead_offer":
      return {
        ...core,
        offer_id: "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3",
        expected_offer_status: "offered",
      };
    case "set_agent_pending":
      return { ...core, agent_id: PENDING_AGENT, expected_agent_status: "approved" };
    case "set_agent_fallback_dispatch":
      return { ...core, agent_id: PENDING_AGENT, is_fallback_agent: true };
    case "set_agent_service_radius":
      return { ...core, agent_id: PENDING_AGENT, service_radius_km: 10 };
    case "reopen_airtel_registration_pending":
    case "reopen_safaricom_registration_pending":
      return { ...core, registration_id: REG_AIRTEL, expected_registration_status: "rejected" };
    default:
      return core;
  }
}

describe("Phase 1A.3 action catalog", () => {
  it("lists all Phase 1A.3 action tools when configured", () => {
    const tools = listActionTools(devCfg());
    expect(tools.length).toBe(ACTION_TOOL_NAMES.length);
    expect(tools.map((t) => t.name)).toContain("wam.business.agents.approve_agent");
    expect(tools.map((t) => t.name)).toContain("wam.business.registrations.confirm_airtel_installation");
    expect(tools.map((t) => t.name)).toContain("wam.business.leads.revert_lead_pending_install");
  });

  it("hides financial tools when financial kill switch off", () => {
    const tools = listActionTools(devCfg({ WAM_AI_FINANCIAL_ACTIONS_ENABLED: "0" }));
    const financial = ACTION_TOOL_NAMES.filter((t) => ACTION_TOOL_FINANCIAL[t]);
    for (const t of financial) {
      expect(tools.map((x) => x.name)).not.toContain(fullActionToolName(t));
    }
  });

  it("parses namespaced action tool names", () => {
    expect(parseActionToolName("wam.business.agents.approve_agent")).toBe("approve_agent");
    expect(parseAnyToolName("wam.business.leads.mark_lead_lost")?.kind).toBe("action");
  });
});

describe("Phase 1A.3 required expected-state (MCP schema)", () => {
  const phase13Tools = ACTION_TOOL_NAMES.filter(
    (t) => t !== "create_lead_offer" && t !== "set_agent_fallback_dispatch" && t !== "set_agent_service_radius",
  );

  it.each(phase13Tools)("requires expected field for %s", (tool) => {
    const field = EXPECTED_FIELD[tool];
    if (!field) return;
    const args = minimalArgs(tool);
    delete args[field!];
    expect(() => parseActionArgs(tool, args)).toThrow();
  });

  it("keeps create_lead_offer backward compatible (expected fields optional)", () => {
    const parsed = parseActionArgs("create_lead_offer", {
      ...actionCore("Offer"),
      lead_id: "77777777-7777-7777-7777-777777777777",
      agent_id: PENDING_AGENT,
    });
    expect(parsed.lead_id).toBeTruthy();
  });
});

describe("Phase 1A.3 authorization matrix", () => {
  beforeEach(() => resetRateLimitState());

  it("allows technical_owner and business_partner for approve_agent", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({
      call: async () => ({ status: "success", operation: "approve_agent" }),
    });
    for (const actor of [ownerActor, partnerActor]) {
      const res = await executeActionTool({
        tool: "approve_agent",
        args: { ...actionCore("Approve"), agent_id: PENDING_AGENT, expected_agent_status: "pending" },
        cfg: devCfg(),
        db,
        actionDb,
        actor,
      });
      expect(res.ok).toBe(true);
    }
  });

  it("denies ai_service and unknown roles before SQL", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient();
    for (const actor of [aiActor, { ...partnerActor, actorRole: "unknown" as const }]) {
      const res = await executeActionTool({
        tool: "approve_agent",
        args: {
          ...actionCore("Approve"),
          agent_id: PENDING_AGENT,
          expected_agent_status: "pending",
        },
        cfg: devCfg(),
        db,
        actionDb,
        actor,
      });
      expect(res.denied).toBe(true);
    }
  });

  it.each([
    ["confirm_lead_installation", { lead_id: LEAD_INSTALL, expected_lead_status: "pending_install" }],
    ["confirm_airtel_installation", { registration_id: REG_AIRTEL, expected_registration_status: "pending" }],
    ["revert_lead_pending_install", { lead_id: LEAD_INSTALLED, expected_lead_status: "installed" }],
  ] as const)("denies financial %s when kill switch off", async (tool, extra) => {
    const res = await executeActionTool({
      tool,
      args: { ...actionCore("Financial"), ...extra },
      cfg: devCfg({ WAM_AI_FINANCIAL_ACTIONS_ENABLED: "0" }),
      db: createMockDbClient(),
      actionDb: createMockActionDbClient(),
      actor: ownerActor,
    });
    expect(res.denied).toBe(true);
    expect(res.error?.category).toBe("action_disabled");
  });
});

describe("Phase 1A.3 validation and SQL error mapping", () => {
  it("requires agent identifier for approve_agent", () => {
    expect(() =>
      parseActionArgs("approve_agent", {
        ...actionCore("Approve"),
        expected_agent_status: "pending",
      }),
    ).toThrow();
  });

  it("requires dispatch_scope and expected_dispatch_scope for change_dispatch_scope", () => {
    expect(() =>
      parseActionArgs("change_dispatch_scope", {
        ...actionCore("Scope"),
        agent_id: PENDING_AGENT,
        dispatch_scope: "airtel",
      }),
    ).toThrow();
    const p = parseActionArgs("change_dispatch_scope", {
      ...actionCore("Scope"),
      agent_id: PENDING_AGENT,
      dispatch_scope: "airtel",
      expected_dispatch_scope: "both",
    });
    expect(p.dispatch_scope).toBe("airtel");
  });

  it("category kill switches", () => {
    const cfg = devCfg({ WAM_AI_AGENT_ACTIONS_ENABLED: "0" });
    expect(isActionCategoryEnabled(cfg, "agents")).toBe(false);
    expect(isActionCategoryEnabled(cfg, "dispatch")).toBe(true);
  });
});

describe("Phase 1A.3 contract table (MCP executeActionTool)", () => {
  beforeEach(() => resetRateLimitState());

  const cases: Array<{
    name: string;
    tool: ActionToolName;
    args: Record<string, unknown>;
    mockPayload: Record<string, unknown>;
    assert: (res: Awaited<ReturnType<typeof executeActionTool>>) => void;
  }> = [
    {
      name: "approve success",
      tool: "approve_agent",
      args: { ...actionCore("Approve"), agent_id: PENDING_AGENT, expected_agent_status: "pending" },
      mockPayload: {
        status: "success",
        notification_summary: { created: true, source: "database_trigger", push_delivery: "not_sent_from_rpc" },
      },
      assert: (res) => expect(res.ok).toBe(true),
    },
    {
      name: "expected_state_conflict from SQL",
      tool: "mark_lead_rejected",
      args: {
        ...actionCore("Reject"),
        lead_id: "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4",
        expected_lead_status: "assigned",
      },
      mockPayload: { status: "error", error_category: "expected_state_conflict" },
      assert: (res) => {
        expect(res.ok).toBe(false);
        expect(res.error?.category).toBe("expected_state_conflict");
      },
    },
    {
      name: "active_offer_exists from SQL",
      tool: "mark_lead_rejected",
      args: {
        ...actionCore("Reject offered"),
        lead_id: "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2",
        expected_lead_status: "offered",
      },
      mockPayload: { status: "error", error_category: "active_offer_exists" },
      assert: (res) => expect(res.error?.category).toBe("active_offer_exists"),
    },
    {
      name: "commission_present from SQL",
      tool: "mark_lead_rejected",
      args: {
        ...actionCore("Reject commission"),
        lead_id: "f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6",
        expected_lead_status: "assigned",
      },
      mockPayload: { status: "error", error_category: "commission_present" },
      assert: (res) => expect(res.error?.category).toBe("commission_present"),
    },
    {
      name: "confirm_lead_installation financial effect",
      tool: "confirm_lead_installation",
      args: {
        ...actionCore("Confirm"),
        lead_id: LEAD_INSTALL,
        expected_lead_status: "pending_install",
      },
      mockPayload: {
        status: "success",
        financial_effect: { changed: true, commission_before: null, commission_after: 200 },
        notification_summary: { source: "rpc_insert", push_delivery: "not_sent_from_rpc" },
      },
      assert: (res) => {
        expect(res.ok).toBe(true);
        const data = res.data as { financial_effect: { changed: boolean } };
        expect(data.financial_effect.changed).toBe(true);
      },
    },
    {
      name: "revert_lead_pending_install financial",
      tool: "revert_lead_pending_install",
      args: {
        ...actionCore("Revert"),
        lead_id: LEAD_INSTALLED,
        expected_lead_status: "installed",
      },
      mockPayload: {
        status: "success",
        financial_effect: { changed: true, commission_before: 200, commission_after: null },
        action_reference: IDEM,
        audit_reference: "corr-1",
      },
      assert: (res) => {
        expect(res.ok).toBe(true);
        const data = res.data as { financial_effect: { changed: boolean } };
        expect(data.financial_effect.changed).toBe(true);
      },
    },
    {
      name: "revert invalid_transition from rejected",
      tool: "revert_lead_pending_install",
      args: {
        ...actionCore("Revert bad"),
        lead_id: "e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5",
        expected_lead_status: "rejected",
      },
      mockPayload: { status: "error", error_category: "invalid_transition" },
      assert: (res) => expect(res.error?.category).toBe("invalid_transition"),
    },
    {
      name: "idempotent replay ban_agent",
      tool: "ban_agent",
      args: {
        ...actionCore("Ban"),
        agent_id: "11111111-1111-1111-1111-111111111111",
        expected_agent_status: "approved",
      },
      mockPayload: {
        status: "success",
        idempotent_replay: true,
        outstanding_workload: { active_offers: 1, assigned_leads: 0 },
      },
      assert: (res) => {
        expect(res.ok).toBe(true);
        expect((res.data as { idempotent_replay: boolean }).idempotent_replay).toBe(true);
      },
    },
    {
      name: "terminal lead financial unchanged",
      tool: "mark_lead_rejected",
      args: {
        ...actionCore("Terminal"),
        lead_id: "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4",
        expected_lead_status: "assigned",
      },
      mockPayload: {
        status: "success",
        financial_effect: { changed: false },
        assigned_agent_cleared: false,
      },
      assert: (res) => {
        expect(res.ok).toBe(true);
        expect((res.data as { financial_effect: { changed: boolean } }).financial_effect.changed).toBe(false);
      },
    },
    {
      name: "confirm_airtel honest financial changed flag",
      tool: "confirm_airtel_installation",
      args: {
        ...actionCore("Reg"),
        registration_id: REG_AIRTEL,
        expected_registration_status: "pending",
      },
      mockPayload: {
        status: "success",
        financial_effect: { changed: true, agent_balance_before: 200, agent_balance_after: 700 },
        notification_summary: { source: "database_trigger", push_delivery: "not_sent_from_rpc" },
      },
      assert: (res) => expect(res.ok).toBe(true),
    },
  ];

  it.each(cases)("$name", async ({ tool, args, mockPayload, assert }) => {
    const res = await executeActionTool({
      tool,
      args,
      cfg: devCfg(),
      db: createMockDbClient(),
      actionDb: createMockActionDbClient({ call: async () => mockPayload }),
      actor: ownerActor,
    });
    assert(res);
  });
});

describe("Phase 1A.3 financial classification registry", () => {
  it("marks only proven financial actions", () => {
    expect(ACTION_TOOL_FINANCIAL.confirm_airtel_installation).toBe(true);
    expect(ACTION_TOOL_FINANCIAL.confirm_lead_installation).toBe(true);
    expect(ACTION_TOOL_FINANCIAL.revert_lead_pending_install).toBe(true);
    expect(ACTION_TOOL_FINANCIAL.mark_lead_rejected).toBe(false);
    expect(ACTION_TOOL_FINANCIAL.mark_lead_cancelled).toBe(false);
    expect(ACTION_TOOL_FINANCIAL.confirm_safaricom_installation).toBe(false);
  });
});
