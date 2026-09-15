import { describe, expect, it, beforeEach } from "vitest";
import {
  loadConfig,
  resolveActorFromConfig,
  validateConfigForStart,
} from "../src/config.js";
import { createMockDbClient } from "../src/db.js";
import { checkRateLimit, rateLimitKey, resetRateLimitState } from "../src/rateLimit.js";
import { truncateJson } from "../src/redact.js";
import { resolveActor } from "../src/server.js";
import { executeBusinessTool } from "../src/tools.js";
import {
  assignedProgressAt,
  clipBucketWindow,
  exactStallTotals,
  hasValidActiveOffer,
  productSummaryFields,
  stallCodeStuckOffer,
} from "../src/sqlLogic.js";
import {
  BUSINESS_TOOL_NAMES,
  TOOL_INPUTS,
  TOOL_SCHEMAS,
  ValidationError,
  validateRange,
} from "../src/validation.js";

beforeEach(() => {
  resetRateLimitState();
});

const actor = {
  actorId: "unverified:partner",
  actorRole: "business_partner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

function devCfg(extra: Record<string, string> = {}) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "partner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "business_partner",
    WAM_AI_RATE_LIMIT_PER_MINUTE: "30",
    ...extra,
  });
}

describe("sqlLogic: assigned progress", () => {
  it("uses latest non-null timestamp (newer KYC beats older call)", () => {
    const progress = assignedProgressAt(
      "2026-08-01T10:00:00Z",
      "2026-08-02T12:00:00Z",
      null,
      null,
      "2026-08-01T09:00:00Z",
    );
    expect(progress?.toISOString()).toBe("2026-08-02T12:00:00.000Z");
  });

  it("newer update beats older call", () => {
    const progress = assignedProgressAt(
      "2026-08-01T10:00:00Z",
      null,
      null,
      "2026-08-03T08:00:00Z",
      "2026-08-01T09:00:00Z",
    );
    expect(progress?.toISOString()).toBe("2026-08-03T08:00:00.000Z");
  });

  it("falls back to created_at when others null", () => {
    const progress = assignedProgressAt(null, null, null, null, "2026-08-01T09:00:00Z");
    expect(progress?.toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });
});

describe("sqlLogic: stuck offers", () => {
  const now = new Date("2026-08-27T12:00:00Z");
  const timeout = 10;

  it("marks STUCK_OFFER when offered lead has no offer row", () => {
    expect(stallCodeStuckOffer(now, "offered", [], timeout)).toBe("STUCK_OFFER");
    expect(hasValidActiveOffer(now, [], timeout)).toBe(false);
  });

  it("marks STUCK_OFFER when latest offer expired", () => {
    const offers = [
      {
        status: "offered",
        createdAt: "2026-08-27T10:00:00Z",
        expiresAt: "2026-08-27T11:00:00Z",
      },
    ];
    expect(hasValidActiveOffer(now, offers, timeout)).toBe(false);
    expect(stallCodeStuckOffer(now, "offered", offers, timeout)).toBe("STUCK_OFFER");
  });

  it("does not mark stuck when a valid offer exists after expired historical", () => {
    const offers = [
      {
        status: "offered",
        createdAt: "2026-08-27T08:00:00Z",
        expiresAt: "2026-08-27T09:00:00Z",
      },
      {
        status: "offered",
        createdAt: "2026-08-27T11:50:00Z",
        expiresAt: "2026-08-27T12:30:00Z",
      },
    ];
    expect(hasValidActiveOffer(now, offers, timeout)).toBe(true);
    expect(stallCodeStuckOffer(now, "offered", offers, timeout)).toBeNull();
  });

  it("treats null expires_at as valid within timeout window", () => {
    const offers = [
      {
        status: "offered",
        createdAt: "2026-08-27T11:55:00Z",
        expiresAt: null,
      },
    ];
    expect(hasValidActiveOffer(now, offers, timeout)).toBe(true);
  });
});

describe("sqlLogic: exact exception counts", () => {
  it("totals ignore display limit beyond 100 matching records", () => {
    const codes = Array.from({ length: 150 }, (_, i) =>
      i % 2 === 0 ? "STUCK_OFFER" : "DISPATCH_BACKLOG",
    );
    const result = exactStallTotals(codes, 100);
    expect(result.total).toBe(150);
    expect(result.displayed).toHaveLength(100);
    expect(result.countsByCode.STUCK_OFFER).toBe(75);
    expect(result.countsByCode.DISPATCH_BACKLOG).toBe(75);
  });
});

describe("sqlLogic: trend bucket clipping", () => {
  it("clips partial first and final buckets inside range", () => {
    const rangeFrom = new Date("2026-08-01T06:00:00Z");
    const rangeTo = new Date("2026-08-03T18:00:00Z");
    const dayMs = 86_400_000;

    const first = clipBucketWindow(
      new Date("2026-08-01T00:00:00Z"),
      dayMs,
      rangeFrom,
      rangeTo,
    );
    expect(first?.windowFrom.toISOString()).toBe("2026-08-01T06:00:00.000Z");
    expect(first!.windowTo.getTime()).toBeLessThanOrEqual(
      new Date("2026-08-01T23:59:59.999Z").getTime(),
    );

    const last = clipBucketWindow(
      new Date("2026-08-03T00:00:00Z"),
      dayMs,
      rangeFrom,
      rangeTo,
    );
    expect(last?.windowTo.toISOString()).toBe("2026-08-03T18:00:00.000Z");
    expect(last!.windowFrom.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-08-03T00:00:00Z").getTime(),
    );
  });

  it("returns null for empty clipped windows", () => {
    expect(
      clipBucketWindow(
        new Date("2026-07-01T00:00:00Z"),
        86_400_000,
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-02T00:00:00Z"),
      ),
    ).toBeNull();
  });
});

describe("sqlLogic: product-filter consistency", () => {
  it("labels airtel/safaricom inclusion correctly", () => {
    expect(productSummaryFields(null).includeAirtelRegistrations).toBe(true);
    expect(productSummaryFields(null).includeSafaricomRegistrations).toBe(true);
    expect(productSummaryFields("airtel").includeSafaricomRegistrations).toBe(false);
    expect(productSummaryFields("safaricom").includeAirtelRegistrations).toBe(false);
    expect(productSummaryFields("airtel").platformWideFields).toContain("platform_wide.*");
  });
});

describe("hard 90-day maximum", () => {
  it("MCP rejects over 90 days", () => {
    expect(() =>
      validateRange("2026-01-01T00:00:00.000Z", "2026-04-15T00:00:00.000Z"),
    ).toThrow(ValidationError);
    expect(() =>
      validateRange("2026-01-01T00:00:00.000Z", "2026-03-31T00:00:00.000Z"),
    ).not.toThrow();
  });
});

describe("correlated audit events", () => {
  it("links pre/completion/denial/failure with one server UUID", async () => {
    const db = createMockDbClient({
      call: async () => ({ inbound_leads_created: 1 }),
    });
    const res = await executeBusinessTool({
      tool: "get_operational_summary",
      args: {},
      cfg: devCfg(),
      db,
      actor,
    });
    expect(res.ok).toBe(true);
    expect(res.auditId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(res.correlationId).toBe(res.auditId);
    expect(new Set(db.audits.map((a) => a.correlationId)).size).toBe(1);
    expect(db.audits.every((a) => a.instanceId === actor.instanceId)).toBe(true);
    expect(db.audits.every((a) => a.identityVerified === false)).toBe(true);
  });

  it("uses same correlation on denial path", async () => {
    const db = createMockDbClient();
    const res = await executeBusinessTool({
      tool: "get_operational_summary",
      args: { product: "nope" },
      cfg: devCfg(),
      db,
      actor,
    });
    expect(res.ok).toBe(false);
    expect(db.audits[0]?.correlationId).toBe(res.auditId);
    expect(db.audits[0]?.outcome).toBe("denied");
  });
});

describe("instance-bound identity", () => {
  it("production requires instance id, actor id, and allowed role", () => {
    expect(
      validateConfigForStart(
        loadConfig({
          WAM_AI_IDENTITY_MODE: "production",
          WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@h/db",
        }),
      ).ok,
    ).toBe(false);

    const partner = loadConfig({
      WAM_AI_IDENTITY_MODE: "production",
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@h/db",
      WAM_AI_INSTANCE_ID: "gw-partner",
      WAM_AI_INSTANCE_ACTOR_ID: "partner-1",
      WAM_AI_INSTANCE_ACTOR_ROLE: "business_partner",
    });
    expect(validateConfigForStart(partner).ok).toBe(true);
    expect(partner.instanceActor.identityVerified).toBe(true);
    expect(resolveActorFromConfig(partner).actorRole).toBe("business_partner");
  });

  it("never takes identity from resolveActor meta", () => {
    const cfg = devCfg();
    const a = resolveActor(cfg, {
      actorId: "evil",
      actorRole: "technical_owner",
      identityVerified: true,
      instanceId: "hijack",
    });
    expect(a.actorId).toBe(cfg.instanceActor.actorId);
    expect(a.identityVerified).toBe(false);
    expect(a.instanceId).toBe(cfg.instanceActor.instanceId);
  });
});

describe("rate limiting", () => {
  it("denies after limit without reporting DB call", async () => {
    const cfg = { ...devCfg(), rateLimitPerMinute: 2 };
    const db = createMockDbClient({
      call: async () => ({ ok: true }),
    });
    const keyActor = {
      ...actor,
      actorId: "rl-actor",
      instanceId: "rl-inst",
    };
    const r1 = await executeBusinessTool({
      tool: "get_operational_exceptions",
      args: {},
      cfg,
      db,
      actor: keyActor,
    });
    const r2 = await executeBusinessTool({
      tool: "get_operational_exceptions",
      args: {},
      cfg,
      db,
      actor: keyActor,
    });
    const r3 = await executeBusinessTool({
      tool: "get_operational_exceptions",
      args: {},
      cfg,
      db,
      actor: keyActor,
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(false);
    expect(r3.error?.category).toBe("rate_limited");
    expect(db.callCount).toBe(2);
    expect(db.audits.some((a) => a.errorCategory === "rate_limited")).toBe(true);
  });

  it("reset clears windows for tests", () => {
    const key = rateLimitKey("a", "b");
    expect(checkRateLimit(key, 1, 1000).allowed).toBe(true);
    expect(checkRateLimit(key, 1, 1001).allowed).toBe(false);
    resetRateLimitState();
    expect(checkRateLimit(key, 1, 1002).allowed).toBe(true);
  });
});

describe("exact per-tool schemas vs Zod", () => {
  it("schema property keys match TOOL_INPUTS shape", () => {
    for (const name of BUSINESS_TOOL_NAMES) {
      const schemaKeys = Object.keys(TOOL_SCHEMAS[name].properties).sort();
      const shape = TOOL_INPUTS[name].shape as Record<string, unknown>;
      const zodKeys = Object.keys(shape).sort();
      expect(schemaKeys).toEqual(zodKeys);
      expect(TOOL_SCHEMAS[name].additionalProperties).toBe(false);
    }
  });

  it("rejects unknown properties via Zod strict", () => {
    expect(() =>
      TOOL_INPUTS.get_operational_summary.parse({ limit: 5 }),
    ).toThrow();
    expect(() =>
      TOOL_INPUTS.get_overdue_or_stalled_leads.parse({ from: "2026-01-01" }),
    ).toThrow();
  });
});

describe("oversized response safety", () => {
  it("truncateJson never returns payload preview", () => {
    const t = truncateJson({ secret_block: "ABCDEFGHIJKLMNOP".repeat(200) }, 50);
    expect(t.truncated).toBe(true);
    const text = JSON.stringify(t.payload);
    expect(text).not.toContain("ABCDEF");
    expect(t.payload).not.toHaveProperty("preview");
  });
});

describe("forbidden capabilities", () => {
  it("catalog excludes technical/admin/pause/availability/deployment/investigation", () => {
    const joined = BUSINESS_TOOL_NAMES.join(",");
    expect(joined).not.toMatch(/investigate|pause|deploy|admin|availability|technical/i);
  });
});
