import pg from "pg";
import type { AppConfig } from "./config.js";
import { sanitizeErrorMessage } from "./redact.js";

export type AuditWriteResult =
  | { ok: true; id: string }
  | { ok: false; category: "audit_unavailable" };

export type AuditRow = {
  correlationId: string;
  actorId: string;
  actorRole: string;
  sessionOrChannelId: string | null;
  operationName: string;
  toolNamespace: string;
  paramHash: string;
  paramRedacted: Record<string, unknown>;
  dataClassification: string;
  resultCount: number | null;
  outcome: "success" | "denied" | "failure";
  errorCategory: string | null;
  durationMs: number | null;
  instanceId: string | null;
  identityVerified: boolean;
};

export type DbClient = {
  callReportingFn: (schema: string, fn: string, args: unknown[]) => Promise<unknown>;
  recordAudit: (row: AuditRow) => Promise<AuditWriteResult>;
  close: () => Promise<void>;
};

const ALLOWED_REPORTING_FNS = new Set([
  "get_operational_summary",
  "get_agent_performance_summary",
  "get_inbound_lead_funnel",
  "get_unassigned_leads",
  "get_overdue_or_stalled_leads",
  "get_registration_install_trends",
  "get_county_location_demand",
  "get_commission_payment_summary",
  "find_likely_duplicates_or_incomplete",
  "get_operational_exceptions",
]);

export function createDbClient(cfg: AppConfig): DbClient {
  if (!cfg.databaseUrl) {
    throw new Error("database_url_missing");
  }
  const pool = new pg.Pool({
    connectionString: cfg.databaseUrl,
    ssl: { rejectUnauthorized: true },
    max: 4,
    statement_timeout: cfg.queryTimeoutMs,
    query_timeout: cfg.queryTimeoutMs,
  });

  return {
    async callReportingFn(schema, fn, args) {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      if (schema !== "wam_ai" || !ALLOWED_REPORTING_FNS.has(fn)) {
        throw new Error("disallowed_function");
      }
      const sql = `SELECT ${schema}.${fn}(${placeholders}) AS result`;
      try {
        const res = await pool.query(sql, args);
        return res.rows[0]?.result ?? null;
      } catch (err) {
        const s = sanitizeErrorMessage(err);
        const e = new Error(s.message);
        (e as Error & { category?: string }).category = s.category;
        throw e;
      }
    },

    async recordAudit(row) {
      try {
        // 15 params matching wam_ai.record_audit_event migration signature
        const res = await pool.query(
          `SELECT wam_ai.record_audit_event(
            $1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15
          ) AS id`,
          [
            row.correlationId,
            row.actorId,
            row.actorRole,
            row.sessionOrChannelId,
            row.operationName,
            row.toolNamespace,
            row.paramHash,
            JSON.stringify(row.paramRedacted),
            row.dataClassification,
            row.resultCount,
            row.outcome,
            row.errorCategory,
            row.durationMs,
            row.instanceId,
            row.identityVerified,
          ],
        );
        const id = res.rows[0]?.id;
        if (!id || typeof id !== "string") {
          return { ok: false, category: "audit_unavailable" };
        }
        return { ok: true, id };
      } catch {
        // Never surface DB error details (may contain connection info).
        return { ok: false, category: "audit_unavailable" };
      }
    },

    async close() {
      await pool.end();
    },
  };
}

export function createMockDbClient(handlers?: {
  call?: (fn: string, args: unknown[]) => Promise<unknown>;
  auditFail?: boolean;
  /** Fail only after N successful audits (e.g. 1 = fail completion audit). */
  auditFailAfter?: number;
}): DbClient & { audits: AuditRow[]; callCount: number } {
  const audits: AuditRow[] = [];
  let auditWrites = 0;
  let callCount = 0;
  return {
    audits,
    callCount: 0,
    async callReportingFn(_schema, fn, args) {
      callCount += 1;
      (this as { callCount: number }).callCount = callCount;
      if (handlers?.call) return handlers.call(fn, args);
      return { ok: true, fn, args };
    },
    async recordAudit(row) {
      if (handlers?.auditFail) {
        return { ok: false, category: "audit_unavailable" };
      }
      if (
        typeof handlers?.auditFailAfter === "number" &&
        auditWrites >= handlers.auditFailAfter
      ) {
        return { ok: false, category: "audit_unavailable" };
      }
      auditWrites += 1;
      audits.push(row);
      return { ok: true, id: row.correlationId };
    },
    async close() {},
  };
}
