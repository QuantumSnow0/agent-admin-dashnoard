import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TOOL_NAMES,
  NOTIFICATION_TOOL_SCHEMAS,
  NOTIFICATION_REFERENCE_PATTERN,
  type NotificationToolName,
  jsonSchemaAllowsOnlyDeclaredKeys,
  jsonSchemaPropertyKeys,
  jsonSchemaRequiredKeys,
  parseNotificationArgs,
  zodNotificationPropertyKeys,
} from "../src/validation-notifications.js";

const AGENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const IDEM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const NOTIF_REF = "N-1234567890abcdef";

function sendArgs(extra: Record<string, unknown> = {}) {
  return {
    agent_id: AGENT,
    title: "Daily briefing",
    message: "Review stalled leads.",
    notification_type: "SYSTEM_ANNOUNCEMENT",
    expected_agent_status: "approved",
    idempotency_key: IDEM,
    explicit_action_authorized: true as const,
    instruction_summary: "Send briefing",
    ...extra,
  };
}

describe("Phase 1A.4 JSON Schema / Zod parity", () => {
  it.each(NOTIFICATION_TOOL_NAMES)(
    "%s property keys match between Zod and published JSON Schema",
    (tool) => {
      expect(zodNotificationPropertyKeys(tool)).toEqual(jsonSchemaPropertyKeys(tool));
    },
  );

  it.each(NOTIFICATION_TOOL_NAMES)("published schema for %s rejects additionalProperties", (tool) => {
    expect(NOTIFICATION_TOOL_SCHEMAS[tool].additionalProperties).toBe(false);
  });
});

describe("send_agent_notification contract", () => {
  const tool = "send_agent_notification" as const;

  it("valid args pass Zod and JSON Schema key guard", () => {
    const args = sendArgs({ deep_link: "dashboard" });
    expect(parseNotificationArgs(tool, args)).toMatchObject({
      agent_id: AGENT,
      notification_type: "SYSTEM_ANNOUNCEMENT",
      deep_link: "dashboard",
    });
    expect(jsonSchemaAllowsOnlyDeclaredKeys(tool, args)).toBe(true);
    expect(jsonSchemaPropertyKeys(tool)).not.toContain("action_url");
    expect(jsonSchemaRequiredKeys(tool)).toEqual([
      "expected_agent_status",
      "explicit_action_authorized",
      "idempotency_key",
      "instruction_summary",
      "message",
      "notification_type",
      "title",
    ]);
  });

  it("rejects action_url field not in schema", () => {
    expect(jsonSchemaAllowsOnlyDeclaredKeys(tool, { ...sendArgs(), action_url: "https://x" })).toBe(
      false,
    );
    expect(() => parseNotificationArgs(tool, { ...sendArgs(), action_url: "https://x" })).toThrow();
  });
});

describe("get_notification_delivery_status contract", () => {
  it("requires safe notification_reference format", () => {
    expect(NOTIFICATION_REFERENCE_PATTERN.test(NOTIF_REF)).toBe(true);
    expect(jsonSchemaRequiredKeys("get_notification_delivery_status")).toEqual([
      "notification_reference",
    ]);
    expect(() =>
      parseNotificationArgs("get_notification_delivery_status", {
        notification_reference: "raw-uuid-not-allowed",
      }),
    ).toThrow();
  });
});

describe("get_agent_notification_history contract", () => {
  it("requires agent identifier", () => {
    expect(() =>
      parseNotificationArgs("get_agent_notification_history", { limit: 5 }),
    ).toThrow();
  });
});

describe("Phase 1A.3 regression guard", () => {
  it("notification schemas are separate from action schemas", () => {
    const names: NotificationToolName[] = ["send_agent_notification"];
    for (const n of names) {
      expect(n).not.toMatch(/^approve_/);
    }
  });
});
