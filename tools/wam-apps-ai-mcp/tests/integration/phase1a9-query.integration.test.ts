/**
 * Phase 1A.9 disposable integration — requires fixture DB with 1A.9 + visit_date remediation.
 * Skips when WAM_AI_DISPOSABLE_DATABASE_URL / DATABASE_URL is unset.
 */
import { describe, expect, it } from "vitest";
import pg from "pg";

const FIXTURE_URL =
  process.env.WAM_AI_DISPOSABLE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://wam_ai_business_readonly:fixture_only@localhost:5432/wam_ai_fixture_1a9";

const describeIf = FIXTURE_URL ? describe : describe.skip;

describeIf("Phase 1A.9 semantic query (disposable)", () => {
  it("aggregate agents joined this month + ISO/MDY visit today + privilege isolation", async () => {
    const pool = new pg.Pool({ connectionString: FIXTURE_URL, max: 2 });
    try {
      const agg = await pool.query(
        `SELECT wam_ai.aggregate_business_metrics($1::jsonb) AS j`,
        [
          JSON.stringify({
            dataset: "agents",
            metrics: [{ fn: "count", field: "id", alias: "agents_joined" }],
            filters: [{ field: "created_at", op: "relative_range", value: "this_month" }],
            response_mode: "number_only",
          }),
        ],
      );
      const j = agg.rows[0].j as Record<string, unknown>;
      expect(j.status).toBe("success");
      expect(j.dataset).toBe("agents");
      expect(j.response_mode).toBe("number_only");
      expect(typeof j.number).toBe("number");

      const list = await pool.query(
        `SELECT wam_ai.list_business_records($1::jsonb) AS j`,
        [
          JSON.stringify({
            dataset: "customer_registrations",
            filters: [{ field: "visit_date", op: "relative_range", value: "today" }],
            select: ["visit_date", "status", "created_at", "customer_name"],
            limit: 50,
          }),
        ],
      );
      const lj = list.rows[0].j as Record<string, unknown>;
      expect(lj.status).toBe("success");
      expect(lj.dataset).toBe("customer_registrations");
      expect(Number(lj.total_count)).toBeGreaterThanOrEqual(2);
      const rows = lj.rows as Array<Record<string, unknown>>;
      const names = rows.map((r) => r.customer_name);
      expect(names).toEqual(expect.arrayContaining(["1A9 Visit Today MDY", "1A9 Visit Today ISO"]));
      expect(names).not.toContain("1A9 Bad ISO");
      expect(names).not.toContain("1A9 Bad MDY");

      const isoOnly = await pool.query(
        `SELECT wam_ai.aggregate_business_metrics($1::jsonb) AS j`,
        [
          JSON.stringify({
            dataset: "customer_registrations",
            metrics: [{ fn: "count", field: "id", alias: "n" }],
            filters: [
              { field: "visit_date", op: "relative_range", value: "today" },
              { field: "customer_name", op: "ilike_prefix", value: "1A9 ISO-Only Prod" },
            ],
            response_mode: "number_only",
          }),
        ],
      );
      const ij = isoOnly.rows[0].j as Record<string, unknown>;
      expect(ij.status).toBe("success");
      expect(ij.number).toBe(3);

      const denied = await pool.query(
        `SELECT has_table_privilege('wam_ai_business_readonly', 'public.agents', 'SELECT') AS sel,
                has_function_privilege('wam_ai_business_readonly', 'wam_ai.list_business_records(jsonb)', 'EXECUTE') AS exec,
                has_function_privilege('wam_ai_business_actions', 'wam_ai.list_business_records(jsonb)', 'EXECUTE') AS actions_exec`,
      );
      expect(denied.rows[0].sel).toBe(false);
      expect(denied.rows[0].exec).toBe(true);
      expect(denied.rows[0].actions_exec).toBe(false);
    } finally {
      await pool.end();
    }
  });
});
