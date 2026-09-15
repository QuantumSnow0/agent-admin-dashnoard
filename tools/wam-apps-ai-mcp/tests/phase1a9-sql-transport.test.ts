import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledMigrationsDir } from "./resolve-migrations.js";

/**
 * Static contract: user-derived filter values must not be interpolated via %L.
 * Runtime leak tests live in disposable-verify-phase1a9.sql.
 */
describe("Phase 1A.9 SQL transport binding contract", () => {
  const sql = readFileSync(
    join(bundledMigrationsDir(), "20260910120000_wam_ai_phase1a9_semantic_query.sql"),
    "utf8",
  );

  it("has no format(%L) or quote_literal anywhere", () => {
    expect(sql).not.toMatch(/%L/);
    expect(sql).not.toMatch(/quote_literal\s*\(/i);
  });

  it("binds filter values through JSONB $1 positions", () => {
    expect(sql).toMatch(/\$1->>\%s/);
    expect(sql).toMatch(/EXECUTE\s+v_count_sql\s+INTO\s+v_total\s+USING\s+v_binds/);
    expect(sql).toMatch(/EXECUTE\s+v_sql\s+USING\s+v_binds/);
    expect(sql).not.toMatch(/USING\s+VARIADIC/i);
  });

  it("documents allowlisted format fragments only", () => {
    expect(sql).toContain("User-derived values are NEVER interpolated into SQL text");
    expect(sql).toContain("EXECUTE ... USING v_binds");
  });
});
