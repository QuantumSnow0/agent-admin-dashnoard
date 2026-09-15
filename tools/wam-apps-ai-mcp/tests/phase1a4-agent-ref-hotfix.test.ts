import { describe, expect, it, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { createMockActionDbClient } from "../src/actionDb.js";
import { createMockDbClient } from "../src/db.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { executeNotificationTool } from "../src/tools-notifications.js";
import { parseNotificationArgs } from "../src/validation-notifications.js";

const PRODUCTION_AGENT = "f700b74d-ac1e-4033-85d0-840df1087698";
const IDEM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CORR = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const ownerActor = {
  actorId: "unverified:owner",
  actorRole: "technical_owner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

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

describe("Phase 1A.4 agent reference hotfix", () => {
  beforeEach(() => resetRateLimitState());

  it("reproduces production send_agent_notification call shape", async () => {
    const args = {
      agent_id: PRODUCTION_AGENT,
      title: "Kiambu briefing",
      message: "Review stalled leads before end of day.",
      notification_type: "SYSTEM_ANNOUNCEMENT" as const,
      expected_agent_status: "approved",
      expected_recipient_business_id: "A-f700b74d",
      idempotency_key: IDEM,
      explicit_action_authorized: true as const,
      instruction_summary: "Send Kiambu briefing",
    };
    expect(() => parseNotificationArgs("send_agent_notification", args)).not.toThrow();

    const db = createMockDbClient();
    const actionDb = createMockActionDbClient({
      call: async (fn, args) => {
        expect(fn).toBe("send_agent_notification");
        expect(args[0]).toBe(PRODUCTION_AGENT);
        expect(args[11]).toBe("approved");
        expect(args[12]).toBe("A-f700b74d");
        return {
          status: "success",
          operation: "send_agent_notification",
          agent_business_id: "A-F700B74D",
          in_app_created: true,
          push_attempted_by_rpc: false,
          push_delivery_from_rpc: "not_sent",
        };
      },
    });

    const r = await executeNotificationTool({
      tool: "send_agent_notification",
      args,
      cfg: devCfg(),
      db,
      actionDb,
      actor: ownerActor,
    });

    expect(r.ok, JSON.stringify(r)).toBe(true);
    const data = r.data as Record<string, unknown>;
    expect(data.agent_business_id).toBe("A-F700B74D");
  });

  it("passes mixed-case expected_recipient_business_id to RPC unchanged", async () => {
    resetRateLimitState();
    const db = createMockDbClient();
    let capturedExpected: string | null = null;
    const actionDb = createMockActionDbClient({
      call: async (_fn, args) => {
        capturedExpected = args[12] as string;
        return { status: "success", operation: "send_agent_notification" };
      },
    });

    await executeNotificationTool({
      tool: "send_agent_notification",
      args: {
        agent_id: PRODUCTION_AGENT,
        title: "Case probe",
        message: "Mixed case safe reference.",
        notification_type: "SYSTEM_ANNOUNCEMENT" as const,
        expected_agent_status: "approved",
        expected_recipient_business_id: "a-F700B74D",
        idempotency_key: CORR,
        explicit_action_authorized: true as const,
        instruction_summary: "Case probe",
      },
      cfg: devCfg(),
      db,
      actionDb,
      actor: ownerActor,
    });

    expect(capturedExpected).toBe("a-F700B74D");
  });
});
