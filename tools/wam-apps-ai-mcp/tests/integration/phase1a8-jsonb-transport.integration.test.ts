/**
 * Disposable PostgreSQL integration — requires a fixture DB.
 * Run via: npm run test:integration
 * Not part of npm test / npm run test:unit.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildTypedSqlArgs, sqlJsonb, sqlText, sqlInt } from "../../src/sql-args.js";
import { createDbClient } from "../../src/db.js";
import { loadConfig } from "../../src/config.js";
import { INTELLIGENCE_TOOL_TO_SQL } from "../../src/validation-intelligence.js";

const FIXTURE_URL =
  process.env.WAM_AI_DISPOSABLE_DATABASE_URL ||
  "postgresql://wam_ai_business_readonly:fixture_only@localhost:5432/wam_ai_fixture_1a8";

function row(i: number) {
  return {
    row_ref: `R${i}`,
    airtel_phone: `25471183${String(i).padStart(4, "0")}`,
    spreadsheet_installed: true,
  };
}

describe("node-postgres JSONB transport (disposable integration)", () => {
  let pool: pg.Pool;
  let available = false;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: FIXTURE_URL, ssl: false, max: 2 });
    try {
      await pool.query("SELECT wam_ai.reconcile_customer_batch('[]'::jsonb)");
      available = true;
    } catch (err) {
      available = false;
      await pool.end();
      throw new Error(
        `Disposable fixture required for JSONB transport tests (${FIXTURE_URL}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  });

  afterAll(async () => {
    if (available) await pool.end();
  });

  it("raw JS array against jsonb parameter reproduces 22P02", async () => {
    const rows = [row(1)];
    try {
      await pool.query(`SELECT wam_ai.reconcile_customer_batch($1) AS result`, [rows]);
      expect.fail("expected 22P02 for raw JS array");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("22P02");
    }
  });

  it("corrected $1::jsonb + JSON.stringify one-row call succeeds", async () => {
    const rows = [row(1)];
    const res = await pool.query(`SELECT wam_ai.reconcile_customer_batch($1::jsonb) AS result`, [
      JSON.stringify(rows),
    ]);
    expect(res.rows[0].result.status).toBe("success");
    expect(res.rows[0].result.input_row_count).toBe(1);
  });

  it("corrected 51-row call succeeds", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => row(i + 1));
    const res = await pool.query(`SELECT wam_ai.reconcile_customer_batch($1::jsonb) AS result`, [
      JSON.stringify(rows),
    ]);
    expect(res.rows[0].result.status).toBe("success");
    expect(res.rows[0].result.input_row_count).toBe(51);
  });

  it("corrected 250-row call succeeds", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(i + 1));
    const res = await pool.query(`SELECT wam_ai.reconcile_customer_batch($1::jsonb) AS result`, [
      JSON.stringify(rows),
    ]);
    expect(res.rows[0].result.status).toBe("success");
    expect(res.rows[0].result.input_row_count).toBe(250);
  });

  it("DbClient callReportingFn with sqlJsonb succeeds for reconcile", async () => {
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "development",
      WAM_AI_DATABASE_URL: FIXTURE_URL,
      WAM_AI_REQUIRED_DB_USER: "wam_ai_business_readonly",
      WAM_AI_INSTANCE_ID: "dev",
      WAM_AI_INSTANCE_ACTOR_ID: "owner",
      WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
    });
    const db = createDbClient(cfg);
    try {
      const args = INTELLIGENCE_TOOL_TO_SQL.reconcile_customer_batch.argBuilder({
        rows: [row(99)],
      });
      const result = (await db.callReportingFn(
        "wam_ai",
        "reconcile_customer_batch",
        args,
      )) as Record<string, unknown>;
      expect(result.status).toBe("success");
    } finally {
      await db.close();
    }
  });

  it("Phase 1A.8 session flow (251+) succeeds with typed jsonb append", async () => {
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "development",
      WAM_AI_DATABASE_URL: FIXTURE_URL,
      WAM_AI_REQUIRED_DB_USER: "wam_ai_business_readonly",
      WAM_AI_INSTANCE_ID: "dev",
      WAM_AI_INSTANCE_ACTOR_ID: "owner",
      WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
    });
    const db = createDbClient(cfg);
    try {
      const fp = "integration-fp-" + "d".repeat(40) + Date.now();
      const begin = (await db.callReportingFn("wam_ai", "begin_reconcile_session", [
        sqlText(fp),
        sqlText(randomUUID()),
        sqlText("unverified:owner"),
        sqlText("technical_owner"),
        sqlInt(30),
      ])) as Record<string, unknown>;
      expect(begin.status).toBe("success");
      const token = String(begin.session_token);
      const chunk1 = Array.from({ length: 250 }, (_, i) => row(i + 1));
      const chunk2 = [row(1)];
      const a1 = (await db.callReportingFn("wam_ai", "append_reconcile_session_rows", [
        sqlText(token),
        sqlJsonb(chunk1),
        sqlText("unverified:owner"),
        sqlText("technical_owner"),
      ])) as Record<string, unknown>;
      expect(a1).toMatchObject({ status: "success" });
      if (a1.status !== "success") {
        expect.fail(`append failed: ${JSON.stringify(a1)}`);
      }
      const a2 = (await db.callReportingFn("wam_ai", "append_reconcile_session_rows", [
        sqlText(token),
        sqlJsonb(chunk2),
        sqlText("unverified:owner"),
        sqlText("technical_owner"),
      ])) as Record<string, unknown>;
      expect(a2.status).toBe("success");
      const fin = (await db.callReportingFn("wam_ai", "finalize_reconcile_session", [
        sqlText(token),
        sqlText("unverified:owner"),
        sqlText("technical_owner"),
      ])) as Record<string, unknown>;
      expect(fin.status).toBe("success");
      expect(fin.qualifying_spreadsheet_rows).toBe(251);
      expect(fin.unique_input_customers).toBe(250);
    } finally {
      await db.close();
    }
  });

  it("non-JSONB RPCs still succeed (catalogue + lifecycle uuid text)", async () => {
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "development",
      WAM_AI_DATABASE_URL: FIXTURE_URL,
      WAM_AI_REQUIRED_DB_USER: "wam_ai_business_readonly",
      WAM_AI_INSTANCE_ID: "dev",
      WAM_AI_INSTANCE_ACTOR_ID: "owner",
      WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
    });
    const db = createDbClient(cfg);
    try {
      const cat = (await db.callReportingFn(
        "wam_ai",
        "get_notification_capability_catalogue",
        [],
      )) as Record<string, unknown>;
      expect(cat.status).toBe("success");

      const life = (await db.callReportingFn("wam_ai", "get_agent_lifecycle", [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        null,
      ])) as Record<string, unknown>;
      expect(life.status).toBe("success");

      const built = buildTypedSqlArgs([["a", "b"], "x"]);
      expect(Array.isArray(built.values[0])).toBe(true);
      expect(typeof built.values[0]).not.toBe("string");
    } finally {
      await db.close();
    }
  });
});
