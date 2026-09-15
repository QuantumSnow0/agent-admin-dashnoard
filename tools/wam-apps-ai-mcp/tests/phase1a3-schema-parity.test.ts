import { describe, expect, it } from "vitest";
import {
  ACTION_TOOL_NAMES,
  ACTION_TOOL_SCHEMAS,
  type ActionToolName,
  jsonSchemaAllowsOnlyDeclaredKeys,
  jsonSchemaPropertyKeys,
  jsonSchemaRequiredKeys,
  parseActionArgs,
  zodActionPropertyKeys,
} from "../src/validation-actions.js";

const PENDING_AGENT = "55555555-5555-5555-5555-555555555555";
const IDEM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function actionCore(summary: string) {
  return {
    idempotency_key: IDEM,
    explicit_action_authorized: true as const,
    instruction_summary: summary,
  };
}

function validChangeDispatchScopeArgs(extra: Record<string, unknown> = {}) {
  return {
    ...actionCore("Change scope to airtel"),
    agent_id: PENDING_AGENT,
    dispatch_scope: "airtel",
    expected_dispatch_scope: "both",
    ...extra,
  };
}

describe("Phase 1A.3 JSON Schema / Zod parity", () => {
  it.each(ACTION_TOOL_NAMES.filter((t) => t !== "create_lead_offer"))(
    "%s property keys match between Zod and published JSON Schema",
    (tool) => {
      expect(zodActionPropertyKeys(tool)).toEqual(jsonSchemaPropertyKeys(tool));
    },
  );

  it("create_lead_offer property keys match between Zod and JSON Schema", () => {
    expect(zodActionPropertyKeys("create_lead_offer")).toEqual(
      jsonSchemaPropertyKeys("create_lead_offer"),
    );
  });

  it.each(ACTION_TOOL_NAMES)("published schema for %s rejects additionalProperties", (tool) => {
    expect(ACTION_TOOL_SCHEMAS[tool].additionalProperties).toBe(false);
  });
});

describe("change_dispatch_scope contract regression", () => {
  const tool = "change_dispatch_scope" as const;

  it("exact valid parameter set passes Zod and is allowed by published JSON Schema keys", () => {
    const args = validChangeDispatchScopeArgs();
    expect(parseActionArgs(tool, args)).toMatchObject({
      agent_id: PENDING_AGENT,
      dispatch_scope: "airtel",
      expected_dispatch_scope: "both",
    });
    expect(jsonSchemaAllowsOnlyDeclaredKeys(tool, args)).toBe(true);
    expect(jsonSchemaPropertyKeys(tool)).toEqual([
      "agent_business_id",
      "agent_id",
      "dispatch_scope",
      "expected_dispatch_scope",
      "explicit_action_authorized",
      "idempotency_key",
      "instruction_summary",
    ]);
    expect(jsonSchemaRequiredKeys(tool)).toEqual([
      "dispatch_scope",
      "expected_dispatch_scope",
      "explicit_action_authorized",
      "idempotency_key",
      "instruction_summary",
    ]);
  });

  it("rejects reason via Zod and does not publish reason in JSON Schema", () => {
    expect(jsonSchemaPropertyKeys(tool)).not.toContain("reason");
    expect(() =>
      parseActionArgs(tool, validChangeDispatchScopeArgs({ reason: "policy change" })),
    ).toThrow();
    expect(
      jsonSchemaAllowsOnlyDeclaredKeys(tool, validChangeDispatchScopeArgs({ reason: "policy change" })),
    ).toBe(false);
  });

  it("rejects expected_agent_status via Zod and does not publish it in JSON Schema", () => {
    expect(jsonSchemaPropertyKeys(tool)).not.toContain("expected_agent_status");
    expect(() =>
      parseActionArgs(
        tool,
        validChangeDispatchScopeArgs({ expected_agent_status: "approved" }),
      ),
    ).toThrow();
    expect(
      jsonSchemaAllowsOnlyDeclaredKeys(
        tool,
        validChangeDispatchScopeArgs({ expected_agent_status: "approved" }),
      ),
    ).toBe(false);
  });

  it("rejects unknown extra fields via Zod and JSON Schema key contract", () => {
    expect(() =>
      parseActionArgs(tool, validChangeDispatchScopeArgs({ surprise_field: "nope" })),
    ).toThrow();
    expect(
      jsonSchemaAllowsOnlyDeclaredKeys(
        tool,
        validChangeDispatchScopeArgs({ surprise_field: "nope" }),
      ),
    ).toBe(false);
  });

  it("requires a valid UUID idempotency_key", () => {
    expect(() =>
      parseActionArgs(tool, {
        ...validChangeDispatchScopeArgs(),
        idempotency_key: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      parseActionArgs(tool, {
        ...validChangeDispatchScopeArgs(),
        idempotency_key: "",
      }),
    ).toThrow();
  });
});

describe("Phase 1A.3 optional-field parity fixes", () => {
  const noReasonRegistrationTools: ActionToolName[] = [
    "mark_airtel_registration_duplicate",
    "cancel_airtel_registration",
    "confirm_airtel_installation",
    "reject_safaricom_registration",
    "mark_safaricom_registration_duplicate",
    "cancel_safaricom_registration",
    "confirm_safaricom_installation",
  ];

  it.each(noReasonRegistrationTools)("%s rejects reason in Zod and JSON Schema", (tool) => {
    expect(jsonSchemaPropertyKeys(tool)).not.toContain("reason");
    expect(() =>
      parseActionArgs(tool, {
        ...actionCore("Reg action"),
        registration_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        expected_registration_status: "pending",
        reason: "should fail",
      }),
    ).toThrow();
  });

  it("restore_agent rejects reason in Zod and JSON Schema", () => {
    expect(jsonSchemaPropertyKeys("restore_agent")).not.toContain("reason");
    expect(() =>
      parseActionArgs("restore_agent", {
        ...actionCore("Restore"),
        agent_id: PENDING_AGENT,
        expected_agent_status: "banned",
        reason: "should fail",
      }),
    ).toThrow();
  });

  const leadTools: ActionToolName[] = [
    "confirm_lead_installation",
    "mark_lead_rejected",
    "mark_lead_duplicate",
    "mark_lead_cancelled",
    "mark_lead_lost",
    "mark_lead_needs_reassignment",
    "revert_lead_pending_install",
  ];

  it.each(leadTools)("%s rejects reason in Zod and JSON Schema", (tool) => {
    expect(jsonSchemaPropertyKeys(tool)).not.toContain("reason");
    expect(() =>
      parseActionArgs(tool, {
        ...actionCore("Lead action"),
        lead_id: "99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        expected_lead_status: "assigned",
        reason: "should fail",
      }),
    ).toThrow();
  });
});
