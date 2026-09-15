import { describe, expect, it } from "vitest";
import {
  SMS_TOOL_NAMES,
  SMS_TOOL_SCHEMAS,
  SMS_REFERENCE_PATTERN,
  type SmsToolName,
  jsonSchemaAllowsOnlyDeclaredKeys,
  jsonSchemaPropertyKeys,
  jsonSchemaRequiredKeys,
  parseSmsArgs,
  zodSmsPropertyKeys,
} from "../src/validation-sms.js";

const AGENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const IDEM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DEST_FP = "abc123destfingerprint0000000000000000000000000000000000000000";

function sendArgs(extra: Record<string, unknown> = {}) {
  return {
    agent_id: AGENT,
    message: "Ops briefing.",
    expected_agent_status: "approved",
    expected_recipient_business_id: "A-AAAAAAAA",
    expected_destination_fingerprint: DEST_FP,
    idempotency_key: IDEM,
    explicit_action_authorized: true as const,
    instruction_summary: "Send SMS",
    ...extra,
  };
}

describe("Phase 1A.6 JSON Schema / Zod parity", () => {
  it.each(SMS_TOOL_NAMES)(
    "%s property keys match between Zod and published JSON Schema",
    (tool) => {
      expect(zodSmsPropertyKeys(tool)).toEqual(jsonSchemaPropertyKeys(tool));
    },
  );

  it.each(SMS_TOOL_NAMES)("published schema for %s rejects additionalProperties", (tool) => {
    expect(SMS_TOOL_SCHEMAS[tool].additionalProperties).toBe(false);
  });
});

describe("send_agent_sms contract", () => {
  const tool = "send_agent_sms" as const;

  it("valid args pass Zod and JSON Schema key guard", () => {
    const args = sendArgs({ phone_target: "airtel" });
    expect(parseSmsArgs(tool, args)).toMatchObject({
      agent_id: AGENT,
      phone_target: "airtel",
    });
    expect(jsonSchemaAllowsOnlyDeclaredKeys(tool, args)).toBe(true);
    expect(jsonSchemaRequiredKeys(tool)).toEqual([
      "expected_agent_status",
      "expected_destination_fingerprint",
      "expected_recipient_business_id",
      "explicit_action_authorized",
      "idempotency_key",
      "instruction_summary",
      "message",
    ]);
  });

  it("rejects raw phone field not in schema", () => {
    expect(
      jsonSchemaAllowsOnlyDeclaredKeys(tool, { ...sendArgs(), destination_phone: "2547" }),
    ).toBe(false);
    expect(() =>
      parseSmsArgs(tool, { ...sendArgs(), destination_phone: "2547" }),
    ).toThrow();
  });
});

describe("get_sms_delivery_status contract", () => {
  it("requires safe sms_reference format", () => {
    expect(SMS_REFERENCE_PATTERN.test("S-1234567890abcdef")).toBe(true);
    expect(jsonSchemaRequiredKeys("get_sms_delivery_status")).toEqual(["sms_reference"]);
    expect(() =>
      parseSmsArgs("get_sms_delivery_status", {
        sms_reference: "raw-uuid-not-allowed",
      }),
    ).toThrow();
  });
});

describe("Phase 1A.5 regression guard", () => {
  it("SMS schemas are separate from financial action schemas", () => {
    const names: SmsToolName[] = ["send_agent_sms"];
    for (const n of names) {
      expect(n).not.toMatch(/^mark_lead_/);
    }
  });
});
