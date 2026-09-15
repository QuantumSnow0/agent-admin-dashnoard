import { describe, expect, it, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { createMockActionDbClient } from "../src/actionDb.js";
import { createMockDbClient } from "../src/db.js";
import { isAllowedActionFn } from "../src/actionDb.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { parseAnyToolName } from "../src/server.js";
import {
  executeNotificationTool,
  listNotificationTools,
  parseNotificationToolName,
} from "../src/tools-notifications.js";
import {
  NOTIFICATION_TOOL_NAMES,
  NOTIFICATION_READ_TOOL_NAMES,
  NOTIFICATION_ACTION_TOOL_NAMES,
  WAM_ALLOWED_DEEP_LINKS,
  NOTIFICATION_REFERENCE_PATTERN,
  fullNotificationToolName,
  parseNotificationArgs,
  WAM_ALLOWED_NOTIFICATION_TYPES,
} from "../src/validation-notifications.js";

const AGENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const IDEM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NOTIF_REF = "N-aaaaaaaaaaaaaaaa";

const ownerActor = {
  actorId: "unverified:owner",
  actorRole: "technical_owner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

const aiActor = { ...ownerActor, actorRole: "ai_service" as const };

function devCfg(extra: Record<string, string> = {}) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_ACTION_DATABASE_URL: "postgresql://wam_ai_business_actions:x@localhost/postgres",
    WAM_AI_ACTIONS_ENABLED: "1",
    WAM_AI_NOTIFICATION_ACTIONS_ENABLED: "1",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "owner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
    ...extra,
  });
}

function sendArgs(extra: Record<string, unknown> = {}) {
  return {
    agent_id: AGENT,
    title: "Daily briefing",
    message: "Review stalled leads before end of day.",
    notification_type: "SYSTEM_ANNOUNCEMENT",
    expected_agent_status: "approved",
    idempotency_key: IDEM,
    explicit_action_authorized: true as const,
    instruction_summary: "Send daily briefing",
    ...extra,
  };
}

describe("Phase 1A.4 notification tools", () => {
  beforeEach(() => resetRateLimitState());

  it("registers notification namespace tools", () => {
    for (const t of NOTIFICATION_TOOL_NAMES) {
      expect(parseNotificationToolName(fullNotificationToolName(t))).toBe(t);
      expect(parseAnyToolName(fullNotificationToolName(t))?.kind).toBe("notifications");
    }
  });

  it("lists read tools when notification actions disabled", () => {
    const tools = listNotificationTools(devCfg({ WAM_AI_NOTIFICATION_ACTIONS_ENABLED: "0" }));
    expect(tools.map((t) => t.name)).toEqual(
      NOTIFICATION_READ_TOOL_NAMES.map((t) => fullNotificationToolName(t)),
    );
  });

  it("lists read + action when notification actions enabled", () => {
    const tools = listNotificationTools(devCfg());
    expect(tools.length).toBe(NOTIFICATION_TOOL_NAMES.length);
  });

  it("allows only SYSTEM_ANNOUNCEMENT type", () => {
    expect(WAM_ALLOWED_NOTIFICATION_TYPES).toEqual(["SYSTEM_ANNOUNCEMENT"]);
    expect(() =>
      parseNotificationArgs("send_agent_notification", {
        ...sendArgs({ notification_type: "LEAD_OFFER" }),
      }),
    ).toThrow();
  });

  it("allows only verified deep_link routes", () => {
    expect(WAM_ALLOWED_DEEP_LINKS).toEqual(["dashboard"]);
    expect(() =>
      parseNotificationArgs("send_agent_notification", {
        ...sendArgs({ deep_link: "https://evil.example" }),
      }),
    ).toThrow();
    const p = parseNotificationArgs("send_agent_notification", {
      ...sendArgs({ deep_link: "dashboard" }),
    });
    expect(p.deep_link).toBe("dashboard");
  });

  it("rejects action_url (removed from contract)", () => {
    expect(() =>
      parseNotificationArgs("send_agent_notification", {
        ...sendArgs({ action_url: "https://example.com" }),
      }),
    ).toThrow();
  });

  it("rejects missing recipient", () => {
    expect(() =>
      parseNotificationArgs("send_agent_notification", {
        ...sendArgs(),
        agent_id: undefined,
      }),
    ).toThrow();
  });

  it("rejects secret-like title content", () => {
    expect(() =>
      parseNotificationArgs("send_agent_notification", {
        ...sendArgs({ title: "postgresql://user:pass@host/db" }),
      }),
    ).toThrow();
  });

  it("validates notification_reference format for delivery lookup", () => {
    expect(NOTIFICATION_REFERENCE_PATTERN.test(NOTIF_REF)).toBe(true);
    expect(() =>
      parseNotificationArgs("get_notification_delivery_status", {
        notification_reference: "not-a-ref",
      }),
    ).toThrow();
    expect(() =>
      parseNotificationArgs("get_notification_delivery_status", {
        notification_reference: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      }),
    ).toThrow();
  });

  it("denies send when notification kill switch off", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient();
    const r = await executeNotificationTool({
      tool: "send_agent_notification",
      args: sendArgs(),
      cfg: devCfg({ WAM_AI_NOTIFICATION_ACTIONS_ENABLED: "0" }),
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(r.denied).toBe(true);
    expect(r.error?.category).toBe("action_disabled");
  });

  it("denies send for ai_service role", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient();
    const r = await executeNotificationTool({
      tool: "send_agent_notification",
      args: sendArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: aiActor,
    });
    expect(r.denied).toBe(true);
    expect(r.error?.category).toBe("action_not_authorized");
  });

  it("reports honest immediate delivery semantics on success", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({
      call: async () => ({
        status: "success",
        operation: "send_agent_notification",
        in_app_created: true,
        notification_record_created: true,
        push_attempted_by_rpc: false,
        push_delivery_from_rpc: "not_sent",
        provider_accepted: false,
        delivery_confirmed: false,
        delivery_status: "unknown",
        current_device_token_available: false,
        device_token_available_at_creation: false,
      }),
    });
    const r = await executeNotificationTool({
      tool: "send_agent_notification",
      args: sendArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(r.ok).toBe(true);
    const data = r.data as Record<string, unknown>;
    expect(data.push_attempted_by_rpc).toBe(false);
    expect(data.push_delivery_from_rpc).toBe("not_sent");
    expect(data.delivery_confirmed).toBe(false);
    expect(data).not.toHaveProperty("push_attempted");
  });

  it("read history works when action switch disabled", async () => {
    const db = createMockDbClient({
      call: async (fn) => {
        if (fn === "get_agent_notification_history") {
          return { status: "success", result_count: 0, notifications: [] };
        }
        return { ok: true };
      },
    });
    const r = await executeNotificationTool({
      tool: "get_agent_notification_history",
      args: { agent_id: AGENT, limit: 10 },
      cfg: devCfg({ WAM_AI_NOTIFICATION_ACTIONS_ENABLED: "0" }),
      db,
      actionDb: null,
      actor: ownerActor,
    });
    expect(r.ok).toBe(true);
  });

  it("allows action fn allowlist for send", () => {
    expect(isAllowedActionFn("send_agent_notification")).toBe(true);
  });

  it("rejects unknown fields on send", () => {
    expect(() =>
      parseNotificationArgs("send_agent_notification", {
        ...sendArgs(),
        recipient_name: "Alice",
      }),
    ).toThrow();
  });

  it("requires explicit_action_authorized for send", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient();
    const r = await executeNotificationTool({
      tool: "send_agent_notification",
      args: { ...sendArgs(), explicit_action_authorized: false },
      cfg: devCfg(),
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(r.denied).toBe(true);
  });

  it("redacts notification body in audit params", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({
      call: async () => ({ status: "success", operation: "send_agent_notification" }),
    });
    await executeNotificationTool({
      tool: "send_agent_notification",
      args: sendArgs({ message: "Sensitive operational details here" }),
      cfg: devCfg(),
      db,
      actionDb,
      actor: ownerActor,
    });
    const audit = db.audits.find((a) => a.outcome === "success");
    expect(audit?.paramRedacted?.message).toMatch(/\[body:/);
  });
});

describe("Phase 1A.4 broadcast deferral", () => {
  it("broadcast switch defaults off", () => {
    const cfg = devCfg();
    expect(cfg.broadcastActionsEnabled).toBe(false);
  });
});
