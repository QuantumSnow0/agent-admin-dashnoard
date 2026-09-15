import { describe, expect, it } from "vitest";
import {
  INTELLIGENCE_TOOL_NAMES,
  INTELLIGENCE_TOOL_SCHEMAS,
  jsonSchemaAllowsOnlyDeclaredKeys,
  jsonSchemaPropertyKeys,
  parseIntelligenceArgs,
  zodIntelligencePropertyKeys,
} from "../src/validation-intelligence.js";

describe("Phase 1A.7 JSON Schema / Zod parity", () => {
  it.each(INTELLIGENCE_TOOL_NAMES)("%s property keys match", (tool) => {
    expect(zodIntelligencePropertyKeys(tool)).toEqual(jsonSchemaPropertyKeys(tool));
    expect(INTELLIGENCE_TOOL_SCHEMAS[tool].additionalProperties).toBe(false);
  });

  it("reconcile schema rejects unknown top-level keys", () => {
    expect(
      jsonSchemaAllowsOnlyDeclaredKeys("reconcile_customer_batch", {
        rows: [],
        sql: "select 1",
      }),
    ).toBe(false);
    expect(() =>
      parseIntelligenceArgs("reconcile_customer_batch", { rows: [], sql: "select 1" }),
    ).toThrow();
  });
});
