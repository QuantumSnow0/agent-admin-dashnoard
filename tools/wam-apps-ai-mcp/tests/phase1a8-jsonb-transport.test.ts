import { describe, expect, it } from "vitest";
import { buildTypedSqlArgs, encodeJsonbParam, sqlJsonb } from "../src/sql-args.js";
import { INTELLIGENCE_TOOL_TO_SQL } from "../src/validation-intelligence.js";

describe("sql-args typed encoding (unit)", () => {
  it("jsonb args become JSON strings with ::jsonb cast", () => {
    const rows = [{ row_ref: "a" }];
    const built = buildTypedSqlArgs([sqlJsonb(rows), "plain", [1, 2, 3]]);
    expect(built.placeholders).toBe("$1::jsonb, $2, $3");
    expect(built.values[0]).toBe(JSON.stringify(rows));
    expect(typeof built.values[0]).toBe("string");
    // Unmarked JS array must remain an array (PG array encoding path)
    expect(Array.isArray(built.values[2])).toBe(true);
    expect(built.values[2]).toEqual([1, 2, 3]);
  });

  it("encodeJsonbParam stringifies objects and arrays", () => {
    expect(encodeJsonbParam([])).toBe("[]");
    expect(JSON.parse(encodeJsonbParam([{ a: 1 }]))).toEqual([{ a: 1 }]);
  });

  it("intelligence argBuilder uses sqlJsonb wrapper", () => {
    const args = INTELLIGENCE_TOOL_TO_SQL.reconcile_customer_batch.argBuilder({
      rows: [{ row_ref: "x" }],
    });
    const built = buildTypedSqlArgs(args);
    expect(built.placeholders).toBe("$1::jsonb");
    expect(built.values[0]).toBe(JSON.stringify([{ row_ref: "x" }]));
  });
});
