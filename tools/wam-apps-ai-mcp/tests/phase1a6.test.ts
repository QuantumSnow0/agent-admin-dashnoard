import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { createMockActionDbClient, isAllowedActionFn } from "../src/actionDb.js";
import { createMockDbClient } from "../src/db.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { parseAnyToolName } from "../src/server.js";
import {
  executeSmsTool,
  listSmsTools,
  setSmsProviderForTests,
} from "../src/tools-sms.js";
import {
  SMS_MAX_MESSAGE_LENGTH,
  createMockSmsProvider,
} from "../src/smsProvider.js";
import {
  SMS_TOOL_NAMES,
  SMS_READ_TOOL_NAMES,
  SMS_ACTION_TOOL_NAMES,
  SMS_REFERENCE_PATTERN,
  fullSmsToolName,
  parseSmsArgs,
  parseSmsToolName,
  estimateSmsSegments,
} from "../src/validation-sms.js";

const AGENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const IDEM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DEST_FP = "abc123destfingerprint0000000000000000000000000000000000000000000000";
const SMS_REF = "S-1234567890abcdef";

const ownerActor = {
  actorId: "unverified:owner",
  actorRole: "technical_owner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

const partnerActor = { ...ownerActor, actorRole: "business_partner" as const };
const aiActor = { ...ownerActor, actorRole: "ai_service" as const };

function devCfg(extra: Record<string, string> = {}) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_ACTION_DATABASE_URL: "postgresql://wam_ai_business_actions:x@localhost/postgres",
    WAM_AI_ACTIONS_ENABLED: "1",
    WAM_AI_SMS_ACTIONS_ENABLED: "1",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "owner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
    ...extra,
  });
}

function sendArgs(extra: Record<string, unknown> = {}) {
  return {
    agent_id: AGENT,
    message: "Ops briefing for today.",
    phone_target: "airtel",
    expected_agent_status: "approved",
    expected_recipient_business_id: "A-AAAAAAAA",
    expected_destination_fingerprint: DEST_FP,
    idempotency_key: IDEM,
    explicit_action_authorized: true as const,
    instruction_summary: "Send ops SMS",
    ...extra,
  };
}

function readyPreparePayload() {
  return {
    status: "ready",
    operation: "send_agent_sms",
    normalized_destination: "254711000001",
    agent_business_id: "A-AAAAAAAA",
    masked_destination: "2547***0001",
    sms_reference: SMS_REF,
  };
}

function successFinalizePayload() {
  return {
    status: "success",
    operation: "send_agent_sms",
    provider_accepted: true,
    delivery_confirmed: false,
    delivery_status: "unknown",
    sms_reference: SMS_REF,
    provider_message_id: "mock-msg-1",
  };
}

describe("Phase 1A.6 SMS tools", () => {
  beforeEach(() => resetRateLimitState());
  afterEach(() => setSmsProviderForTests(null));

  it("registers messaging namespace tools", () => {
    for (const t of SMS_TOOL_NAMES) {
      expect(parseSmsToolName(fullSmsToolName(t))).toBe(t);
      expect(parseAnyToolName(fullSmsToolName(t))?.kind).toBe("messaging");
    }
  });

  it("lists read tools when SMS actions disabled", () => {
    const tools = listSmsTools(devCfg({ WAM_AI_SMS_ACTIONS_ENABLED: "0" }));
    expect(tools.map((t) => t.name)).toEqual(
      SMS_READ_TOOL_NAMES.map((t) => fullSmsToolName(t)),
    );
  });

  it("lists read + action when SMS actions enabled", () => {
    const tools = listSmsTools(devCfg());
    expect(tools.length).toBe(SMS_TOOL_NAMES.length);
  });

  it("kill switches default off for SMS and unchanged for financial/broadcast", () => {
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "development",
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    });
    expect(cfg.smsActionsEnabled).toBe(false);
    expect(cfg.smsBroadcastActionsEnabled).toBe(false);
    expect(cfg.financialActionsEnabled).toBe(false);
    expect(cfg.broadcastActionsEnabled).toBe(false);
    expect(cfg.smsDryRun).toBe(true);
  });

  it("denies send when SMS kill switch off", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient();
    const r = await executeSmsTool({
      tool: "send_agent_sms",
      args: sendArgs(),
      cfg: devCfg({ WAM_AI_SMS_ACTIONS_ENABLED: "0" }),
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(r.denied).toBe(true);
    expect(r.error?.category).toBe("action_disabled");
  });

  it("allows send for business_partner with mocked provider path", async () => {
    const mock = createMockSmsProvider();
    setSmsProviderForTests(mock);
    const db = createMockDbClient({ recordAudit: async () => ({ ok: true, id: "a1" }) });
    const actionDb = createMockActionDbClient({
      call: async (fn) => {
        if (fn === "prepare_send_agent_sms") return readyPreparePayload();
        if (fn === "finalize_send_agent_sms") return successFinalizePayload();
        return { status: "error" };
      },
    });
    try {
      const r = await executeSmsTool({
        tool: "send_agent_sms",
        args: sendArgs(),
        cfg: devCfg(),
        db,
        actionDb,
        actor: partnerActor,
      });
      expect(r.denied).not.toBe(true);
      expect(r.ok).toBe(true);
      expect(mock.calls.length).toBe(1);
    } finally {
      setSmsProviderForTests(null);
    }
  });

  it("records business_partner actor identity on SMS prepare/finalize calls", async () => {
    const mock = createMockSmsProvider();
    setSmsProviderForTests(mock);
    const seen: Array<{ fn: string; actorId: unknown; actorRole: unknown }> =
      [];
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({
      call: async (fn, args) => {
        if (fn === "prepare_send_agent_sms") {
          seen.push({ fn, actorId: args[6], actorRole: args[7] });
          return readyPreparePayload();
        }
        if (fn === "finalize_send_agent_sms") {
          seen.push({ fn, actorId: args[2], actorRole: args[3] });
          return successFinalizePayload();
        }
        return { status: "error" };
      },
    });
    try {
      const r = await executeSmsTool({
        tool: "send_agent_sms",
        args: sendArgs(),
        cfg: devCfg(),
        db,
        actionDb,
        actor: partnerActor,
      });
      expect(r.ok).toBe(true);
      expect(seen.length).toBeGreaterThanOrEqual(2);
      expect(
        seen.every(
          (s) =>
            s.actorId === partnerActor.actorId &&
            s.actorRole === "business_partner",
        ),
      ).toBe(true);
    } finally {
      setSmsProviderForTests(null);
    }
  });

  it("denies send for ai_service", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient();
    const r = await executeSmsTool({
      tool: "send_agent_sms",
      args: sendArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: aiActor,
    });
    expect(r.denied).toBe(true);
    expect(r.error?.category).toBe("action_not_authorized");
  });

  it("requires explicit_action_authorized for send", async () => {
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient();
    const r = await executeSmsTool({
      tool: "send_agent_sms",
      args: { ...sendArgs(), explicit_action_authorized: false },
      cfg: devCfg(),
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(r.denied).toBe(true);
    expect(r.error?.category).toBe("validation");
  });

  it("rejects arbitrary phone number field", () => {
    expect(() =>
      parseSmsArgs("send_agent_sms", {
        ...sendArgs(),
        phone_number: "254712345678",
      }),
    ).toThrow();
  });

  it("rejects control characters in message", () => {
    expect(() =>
      parseSmsArgs("send_agent_sms", {
        ...sendArgs(),
        message: "Hello\x07world",
      }),
    ).toThrow();
  });

  it("rejects message exceeding provider max length", () => {
    expect(() =>
      parseSmsArgs("send_agent_sms", {
        ...sendArgs(),
        message: "x".repeat(SMS_MAX_MESSAGE_LENGTH + 1),
      }),
    ).toThrow();
  });

  it("rejects secret-like message content", () => {
    expect(() =>
      parseSmsArgs("send_agent_sms", {
        ...sendArgs(),
        message: "postgresql://user:pass@host/db",
      }),
    ).toThrow();
  });

  it("validates sms_reference format for delivery lookup", () => {
    expect(SMS_REFERENCE_PATTERN.test(SMS_REF)).toBe(true);
    expect(() =>
      parseSmsArgs("get_sms_delivery_status", {
        sms_reference: "not-a-ref",
      }),
    ).toThrow();
  });

  it("reports honest delivery semantics on provider accept", async () => {
    const mock = createMockSmsProvider();
    setSmsProviderForTests(mock);
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({
      call: async (fn) => {
        if (fn === "prepare_send_agent_sms") return readyPreparePayload();
        if (fn === "finalize_send_agent_sms") return successFinalizePayload();
        return { status: "error" };
      },
    });
    const r = await executeSmsTool({
      tool: "send_agent_sms",
      args: sendArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(r.ok).toBe(true);
    const data = r.data as Record<string, unknown>;
    expect(data.provider_accepted).toBe(true);
    expect(data.delivery_confirmed).toBe(false);
    expect(data.delivery_status).toBe("unknown");
    expect(data).not.toHaveProperty("normalized_destination");
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0]?.msisdn).toBe("254711000001");
  });

  it("never claims delivery on provider rejection", async () => {
    const mock = createMockSmsProvider({
      send: async () => ({
        outcome: "provider_rejected",
        errorCategory: "provider_rejected",
        errorMessage: "Provider rejected SMS (code 12)",
      }),
    });
    setSmsProviderForTests(mock);
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({
      call: async (fn) => {
        if (fn === "prepare_send_agent_sms") return readyPreparePayload();
        if (fn === "finalize_send_agent_sms") {
          return {
            status: "error",
            operation: "send_agent_sms",
            provider_accepted: false,
            delivery_confirmed: false,
            error_category: "provider_rejected",
            message: "Provider rejected SMS",
          };
        }
        return { status: "error" };
      },
    });
    const r = await executeSmsTool({
      tool: "send_agent_sms",
      args: sendArgs(),
      cfg: devCfg(),
      db,
      actionDb,
      actor: ownerActor,
    });
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe("provider_rejected");
    const data = r.data as Record<string, unknown>;
    expect(data.delivery_confirmed).toBeFalsy();
  });

  it("idempotent replay skips second provider submission", async () => {
    const mock = createMockSmsProvider();
    setSmsProviderForTests(mock);
    const db = createMockDbClient();
    let prepareCalls = 0;
    const actionDb = createMockActionDbClient({
      call: async (fn) => {
        if (fn === "prepare_send_agent_sms") {
          prepareCalls += 1;
          if (prepareCalls === 1) return readyPreparePayload();
          return {
            status: "success",
            idempotent_replay: true,
            operation: "send_agent_sms",
            provider_accepted: true,
            delivery_confirmed: false,
          };
        }
        if (fn === "finalize_send_agent_sms") return successFinalizePayload();
        return { status: "error" };
      },
    });
    const cfg = devCfg();
    const opts = {
      tool: "send_agent_sms" as const,
      args: sendArgs(),
      cfg,
      db,
      actionDb,
      actor: ownerActor,
    };
    const first = await executeSmsTool(opts);
    expect(first.ok).toBe(true);
    expect(mock.calls.length).toBe(1);
    const second = await executeSmsTool(opts);
    expect(second.ok).toBe(true);
    expect(mock.calls.length).toBe(1);
  });

  it("redacts SMS body in audit params", async () => {
    const mock = createMockSmsProvider();
    setSmsProviderForTests(mock);
    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({
      call: async (fn) => {
        if (fn === "prepare_send_agent_sms") return readyPreparePayload();
        if (fn === "finalize_send_agent_sms") return successFinalizePayload();
        return { status: "error" };
      },
    });
    await executeSmsTool({
      tool: "send_agent_sms",
      args: sendArgs({ message: "Sensitive operational SMS body" }),
      cfg: devCfg(),
      db,
      actionDb,
      actor: ownerActor,
    });
    const audit = db.audits.find((a) => a.outcome === "success");
    expect(audit?.paramRedacted?.message).toMatch(/\[sms_body:/);
  });

  it("read preview works when SMS action switch disabled", async () => {
    const db = createMockDbClient({
      call: async (fn) => {
        if (fn === "preview_agent_sms_recipient") {
          return {
            status: "success",
            masked_destination: "2547***0001",
            destination_fingerprint: DEST_FP,
          };
        }
        return { ok: true };
      },
    });
    const r = await executeSmsTool({
      tool: "preview_agent_sms_recipient",
      args: { agent_id: AGENT },
      cfg: devCfg({ WAM_AI_SMS_ACTIONS_ENABLED: "0" }),
      db,
      actionDb: null,
      actor: ownerActor,
    });
    expect(r.ok).toBe(true);
  });

  it("allows partner for SMS read tools", async () => {
    const db = createMockDbClient({
      call: async (fn) => {
        if (fn === "get_agent_sms_history") {
          return { status: "success", result_count: 0, messages: [] };
        }
        return { ok: true };
      },
    });
    const r = await executeSmsTool({
      tool: "get_agent_sms_history",
      args: { agent_id: AGENT, limit: 5 },
      cfg: devCfg({ WAM_AI_SMS_ACTIONS_ENABLED: "0" }),
      db,
      actionDb: null,
      actor: partnerActor,
    });
    expect(r.ok).toBe(true);
  });

  it("allows action fn allowlist for SMS prepare/finalize", () => {
    expect(isAllowedActionFn("prepare_send_agent_sms")).toBe(true);
    expect(isAllowedActionFn("finalize_send_agent_sms")).toBe(true);
    expect(isAllowedActionFn("send_agent_sms")).toBe(false);
  });

  it("estimates SMS segments for GSM and Unicode", () => {
    expect(estimateSmsSegments("hello")).toMatchObject({
      encoding: "gsm7_estimate",
      estimated_segments: 1,
    });
    expect(estimateSmsSegments("こんにちは")).toMatchObject({
      encoding: "ucs2_estimate",
    });
  });
});

describe("Phase 1A.6 broadcast deferral", () => {
  it("SMS broadcast switch defaults off and action tool list excludes broadcast", () => {
    const cfg = devCfg({ WAM_AI_SMS_BROADCAST_ACTIONS_ENABLED: "1" });
    expect(cfg.smsBroadcastActionsEnabled).toBe(true);
    expect(SMS_ACTION_TOOL_NAMES).toEqual(["send_agent_sms"]);
    expect(SMS_TOOL_NAMES).not.toContain("send_broadcast_sms");
  });
});
