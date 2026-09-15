import { describe, expect, it, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { createMockDbClient } from "../src/db.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { parseAnyToolName } from "../src/server.js";
import {
  executeIntelligenceTool,
  listIntelligenceTools,
  assertIntelligenceOutputSafe,
} from "../src/tools-intelligence.js";
import {
  INTELLIGENCE_TOOL_NAMES,
  fullIntelligenceToolName,
  parseIntelligenceArgs,
  parseIntelligenceToolName,
  redactIntelligenceAuditArgs,
} from "../src/validation-intelligence.js";

const ownerActor = {
  actorId: "unverified:owner",
  actorRole: "technical_owner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

const partnerActor = { ...ownerActor, actorRole: "business_partner" as const };
const aiActor = { ...ownerActor, actorRole: "ai_service" as const };

function devCfg(extra: Record<string, string> = {}) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "owner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
    ...extra,
  });
}

describe("Phase 1A.7 intelligence tools", () => {
  beforeEach(() => resetRateLimitState());

  it("registers intelligence namespace tools", () => {
    for (const t of INTELLIGENCE_TOOL_NAMES) {
      expect(parseIntelligenceToolName(fullIntelligenceToolName(t))).toBe(t);
      expect(parseAnyToolName(fullIntelligenceToolName(t))?.kind).toBe("intelligence");
    }
    expect(listIntelligenceTools().length).toBe(3);
  });

  it("rejects more than 250 rows at Zod layer", () => {
    const rows = Array.from({ length: 251 }, (_, i) => ({
      row_ref: `R${i}`,
      airtel_phone: "254711100001",
    }));
    expect(() => parseIntelligenceArgs("reconcile_customer_batch", { rows })).toThrow();
  });

  it("accepts empty and 250-row batches", () => {
    expect(parseIntelligenceArgs("reconcile_customer_batch", { rows: [] })).toEqual({ rows: [] });
    const rows = Array.from({ length: 250 }, (_, i) => ({ row_ref: `R${i}` }));
    expect(parseIntelligenceArgs("reconcile_customer_batch", { rows }).rows).toHaveLength(250);
  });

  it("rejects arbitrary phone field names not in schema", () => {
    expect(() =>
      parseIntelligenceArgs("reconcile_customer_batch", {
        rows: [{ phone: "254711100001" }],
      }),
    ).toThrow();
  });

  it("redacts spreadsheet rows in audit projection", () => {
    const redacted = redactIntelligenceAuditArgs("reconcile_customer_batch", {
      rows: [{ airtel_phone: "254711100001", customer_name: "Secret" }],
    });
    expect(redacted.row_count).toBe(1);
    expect(JSON.stringify(redacted)).not.toContain("254711100001");
    expect(JSON.stringify(redacted)).not.toContain("Secret");
  });

  it("blocks raw MSISDN and internal UUIDs in outputs", () => {
    expect(
      assertIntelligenceOutputSafe({
        airtel_phone_masked: "2547****001",
        hub: { phone: "254711100001" },
      }).length,
    ).toBeGreaterThan(0);
    expect(
      assertIntelligenceOutputSafe({
        hub_matches: [{ record_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      assertIntelligenceOutputSafe({
        hub_matches: [{ lead_ref: "L-abcdef123456", status: "installed" }],
      }),
    ).toEqual([]);
    expect(
      assertIntelligenceOutputSafe({
        airtel_phone_masked: "2547****001",
        classification: "exact",
      }),
    ).toEqual([]);
  });

  it("allows owner and partner; denies ai_service", async () => {
    const db = createMockDbClient({
      call: async () => ({ status: "success", input_row_count: 0, rows: [] }),
    });
    const okOwner = await executeIntelligenceTool({
      tool: "reconcile_customer_batch",
      args: { rows: [] },
      cfg: devCfg(),
      db,
      actor: ownerActor,
    });
    expect(okOwner.ok).toBe(true);

    const okPartner = await executeIntelligenceTool({
      tool: "get_notification_capability_catalogue",
      args: {},
      cfg: devCfg(),
      db: createMockDbClient({
        call: async () => ({ status: "success", result_count: 9, catalogue: [] }),
      }),
      actor: partnerActor,
    });
    expect(okPartner.ok).toBe(true);

    const denied = await executeIntelligenceTool({
      tool: "reconcile_customer_batch",
      args: { rows: [] },
      cfg: devCfg(),
      db,
      actor: aiActor,
    });
    expect(denied.denied).toBe(true);
  });

  it("preserves financial and SMS kill switch defaults", () => {
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "development",
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    });
    expect(cfg.financialActionsEnabled).toBe(false);
    expect(cfg.broadcastActionsEnabled).toBe(false);
    expect(cfg.smsActionsEnabled).toBe(false);
    expect(cfg.smsDryRun).toBe(true);
  });

  it("lifecycle requires agent identifier", () => {
    expect(() => parseIntelligenceArgs("get_agent_lifecycle", {})).toThrow();
  });
});
