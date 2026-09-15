import pg from "pg";
import type { AppConfig } from "./config.js";
import { buildPoolConfig } from "./db.js";
import { sanitizeErrorMessage } from "./redact.js";
import { ACTION_TOOL_SQL_FN } from "./validation-actions.js";
import { NOTIFICATION_ACTION_SQL_FN } from "./validation-notifications.js";
import { SMS_ACTION_SQL_FN } from "./validation-sms.js";

export type ActionDbClient = {
  callActionFn: (fn: string, args: unknown[]) => Promise<unknown>;
  close: () => Promise<void>;
};

const ALLOWED_ACTION_FNS = new Set<string>([
  ...Object.values(ACTION_TOOL_SQL_FN),
  ...Object.values(NOTIFICATION_ACTION_SQL_FN),
  ...Object.values(SMS_ACTION_SQL_FN),
  "finalize_send_agent_sms",
]);

export function buildActionPoolConfig(cfg: AppConfig): {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true };
  max: number;
  statement_timeout: number;
  query_timeout: number;
} {
  if (!cfg.actionDatabaseUrl) {
    throw new Error("action_database_url_missing");
  }
  const readCfg = { ...cfg, databaseUrl: cfg.actionDatabaseUrl, requiredDbUser: cfg.requiredActionDbUser };
  return buildPoolConfig(readCfg);
}

export function createActionDbClient(cfg: AppConfig): ActionDbClient {
  const pool = new pg.Pool(buildActionPoolConfig(cfg));
  return {
    async callActionFn(fn, args) {
      if (!ALLOWED_ACTION_FNS.has(fn)) {
        throw new Error("disallowed_action_function");
      }
      const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `SELECT wam_ai.${fn}(${placeholders}) AS result`;
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
    async close() {
      await pool.end();
    },
  };
}

export function createMockActionDbClient(handlers?: {
  call?: (fn: string, args: unknown[]) => Promise<unknown>;
}): ActionDbClient & { callCount: number } {
  let callCount = 0;
  return {
    callCount: 0,
    async callActionFn(fn, args) {
      callCount += 1;
      (this as { callCount: number }).callCount = callCount;
      if (handlers?.call) return handlers.call(fn, args);
      return { status: "success", operation: fn };
    },
    async close() {},
  };
}

export function isAllowedActionFn(fn: string): boolean {
  return ALLOWED_ACTION_FNS.has(fn);
}
