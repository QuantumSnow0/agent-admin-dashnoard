import { describe, expect, it, beforeEach } from "vitest";
import { createMockDbClient } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { executeIntelligenceTool } from "../src/tools-intelligence.js";
import {
  clearAttachmentReuseCache,
  invalidateAttachmentStateForActor,
  lookupExplicitPriorReuse,
  rememberFingerprintReconcile,
  ATTACHMENT_BINDING_STATUS,
} from "../src/attachment-binding.js";

const ownerActor = {
  actorId: "unverified:owner",
  actorRole: "technical_owner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

function devCfg() {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "owner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
  });
}

describe("Phase 1A.8 remediation — intelligence failure audit", () => {
  beforeEach(() => resetRateLimitState());

  it("outer catch attempts failure audit and returns auditId only if persisted", async () => {
    const db = createMockDbClient({
      call: async () => {
        throw Object.assign(new Error("boom"), { category: "db_error" });
      },
    });
    const r = await executeIntelligenceTool({
      tool: "reconcile_customer_batch",
      args: { rows: [] },
      cfg: devCfg(),
      db,
      actor: ownerActor,
    });
    expect(r.ok).toBe(false);
    expect(r.correlationId).toBeTruthy();
    expect(r.auditId).toBe(r.correlationId); // mock persists with correlationId as id
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]!.outcome).toBe("failure");
  });

  it("returns auditId null when failure audit cannot persist", async () => {
    const db = createMockDbClient({
      call: async () => {
        throw new Error("boom");
      },
      auditFail: true,
    });
    const r = await executeIntelligenceTool({
      tool: "reconcile_customer_batch",
      args: { rows: [] },
      cfg: devCfg(),
      db,
      actor: ownerActor,
    });
    expect(r.ok).toBe(false);
    expect(r.auditId).toBeNull();
    expect(r.correlationId).toBeTruthy();
    expect(r.auditId).not.toBe(r.correlationId);
  });

  it("success path returns persisted auditId distinct from claiming unpersisted refs", async () => {
    const db = createMockDbClient({
      call: async () => ({ status: "success", input_row_count: 0 }),
    });
    const r = await executeIntelligenceTool({
      tool: "reconcile_customer_batch",
      args: { rows: [] },
      cfg: devCfg(),
      db,
      actor: ownerActor,
    });
    expect(r.ok).toBe(true);
    expect(r.auditId).toBeTruthy();
    expect(r.auditId).toBe(r.correlationId);
  });

  it("denied paths never claim an auditId", async () => {
    const db = createMockDbClient();
    const r = await executeIntelligenceTool({
      tool: "reconcile_customer_batch",
      args: { rows: [] },
      cfg: devCfg(),
      db,
      actor: { ...ownerActor, actorRole: "ai_service" },
    });
    expect(r.denied).toBe(true);
    expect(r.auditId).toBeNull();
  });
});

describe("Phase 1A.8 remediation — stale attachment isolation", () => {
  beforeEach(() => clearAttachmentReuseCache());

  it("never auto-reuses without allow_prior_fingerprint_reuse", () => {
    rememberFingerprintReconcile(
      {
        actorId: "unverified:owner",
        actorRole: "technical_owner",
        sessionOrChannelId: "ch-1",
        peerRef: null,
        contentFingerprint: "abc",
      },
      "corr-1",
      { unique_input_customers: 1 },
    );
    const miss = lookupExplicitPriorReuse({
      actorId: "unverified:owner",
      actorRole: "technical_owner",
      sessionOrChannelId: "ch-1",
      peerRef: null,
      contentFingerprint: "abc",
      allowPriorFingerprintReuse: false,
      sessionReset: false,
    });
    expect(miss.hit).toBe(false);
  });

  it("explicit reuse requires matching session/peer; /new (session_reset) clears", () => {
    rememberFingerprintReconcile(
      {
        actorId: "unverified:owner",
        actorRole: "technical_owner",
        sessionOrChannelId: "ch-1",
        peerRef: "peer-a",
        contentFingerprint: "fp1",
      },
      "corr-1",
      { unique_input_customers: 5 },
    );
    expect(
      lookupExplicitPriorReuse({
        actorId: "unverified:owner",
        actorRole: "technical_owner",
        sessionOrChannelId: "ch-1",
        peerRef: "peer-a",
        contentFingerprint: "fp1",
        allowPriorFingerprintReuse: true,
        sessionReset: false,
      }).hit,
    ).toBe(true);
    expect(
      lookupExplicitPriorReuse({
        actorId: "unverified:owner",
        actorRole: "technical_owner",
        sessionOrChannelId: "ch-2",
        peerRef: "peer-a",
        contentFingerprint: "fp1",
        allowPriorFingerprintReuse: true,
        sessionReset: false,
      }).hit,
    ).toBe(false);

    invalidateAttachmentStateForActor("unverified:owner");
    expect(
      lookupExplicitPriorReuse({
        actorId: "unverified:owner",
        actorRole: "technical_owner",
        sessionOrChannelId: "ch-1",
        peerRef: "peer-a",
        contentFingerprint: "fp1",
        allowPriorFingerprintReuse: true,
        sessionReset: false,
      }).hit,
    ).toBe(false);

    rememberFingerprintReconcile(
      {
        actorId: "unverified:owner",
        actorRole: "technical_owner",
        sessionOrChannelId: "ch-1",
        peerRef: null,
        contentFingerprint: "fp2",
      },
      "corr-2",
      { unique_input_customers: 2 },
    );
    const afterNew = lookupExplicitPriorReuse({
      actorId: "unverified:owner",
      actorRole: "technical_owner",
      sessionOrChannelId: "ch-1",
      peerRef: null,
      contentFingerprint: "fp2",
      allowPriorFingerprintReuse: true,
      sessionReset: true,
    });
    expect(afterNew.hit).toBe(false);
  });

  it("documents deployment blocker for message-path binding", () => {
    expect(ATTACHMENT_BINDING_STATUS.deployment_blocker).toMatch(/DEPLOYMENT_BLOCKER/);
    expect(ATTACHMENT_BINDING_STATUS.deployment_blocker).toMatch(/current Telegram message/);
  });
});
