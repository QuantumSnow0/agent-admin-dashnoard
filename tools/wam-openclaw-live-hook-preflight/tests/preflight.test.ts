import { describe, expect, it } from "vitest";
import {
  CLAIM_TURN_IDENTITY_FIELDS,
  FILE_CAPTURE_IDENTITY_FIELDS,
  MEDIA_FLAG_FIELDS,
  createLiveHookPreflightState,
  evaluatePreflightPass,
  formatPresenceLogLine,
  isPreflightExplicitlyEnabled,
  isScalarIdentityValue,
  registerLiveHookPreflight,
  scanHookFieldPresence,
} from "../src/presence.js";
import { tryRegisterPreflightPlugin } from "../src/register.js";
import { assertOpenClawVersion } from "../src/version-guard.js";

describe("scalar identity presence", () => {
  it("accepts non-empty string and finite number only", () => {
    expect(isScalarIdentityValue("abc")).toBe(true);
    expect(isScalarIdentityValue(42)).toBe(true);
    expect(isScalarIdentityValue(0)).toBe(true);
    expect(isScalarIdentityValue("")).toBe(false);
    expect(isScalarIdentityValue("   ")).toBe(false);
    expect(isScalarIdentityValue(true)).toBe(false);
    expect(isScalarIdentityValue({ id: "x" })).toBe(false);
  });
});

describe("two-message PASS criteria", () => {
  it("NO-GO when file capture lacks staged qualifying media", () => {
    const state = createLiveHookPreflightState();
    const handlers: Record<
      string,
      (e: Record<string, unknown>, c: Record<string, unknown>) => unknown
    > = {};
    registerLiveHookPreflight(
      {
        on: (hook, handler) => {
          handlers[hook] = handler;
        },
      },
      state,
    );

    handlers.message_received?.(
      {
        messageId: "m1",
        sessionKey: "s1",
        accountId: "a1",
        peerId: "p1",
        senderId: "u1",
      },
      {},
    );
    handlers.before_prompt_build?.(
      { sessionKey: "s1", peerId: "p1", runId: "r1" },
      {},
    );
    handlers.before_tool_call?.(
      { sessionKey: "s1", peerId: "p1", runId: "r1" },
      {},
    );

    const verdict = evaluatePreflightPass(state);
    expect(verdict.pass).toBe(false);
    expect(verdict.blockingAbsent.some((x) => x.includes("staged_media"))).toBe(
      true,
    );
  });

  it("NO-GO when instruction hooks lack runId", () => {
    const state = createLiveHookPreflightState();
    const handlers: Record<
      string,
      (e: Record<string, unknown>, c: Record<string, unknown>) => unknown
    > = {};
    registerLiveHookPreflight(
      {
        on: (hook, handler) => {
          handlers[hook] = handler;
        },
      },
      state,
    );

    handlers.message_received?.(
      {
        messageId: "m1",
        sessionKey: "s1",
        accountId: "a1",
        peerId: "p1",
        senderId: "u1",
        media: [{ path: "/tmp/inbound/f.csv", contentType: "text/csv" }],
      },
      {},
    );
    handlers.before_prompt_build?.({ sessionKey: "s1", peerId: "p1" }, {});
    handlers.before_tool_call?.(
      { sessionKey: "s1", peerId: "p1", runId: "r1" },
      {},
    );

    const verdict = evaluatePreflightPass(state);
    expect(verdict.pass).toBe(false);
    expect(
      verdict.blockingAbsent.some((x) => x === "before_prompt_build:runId"),
    ).toBe(true);
  });

  it("PASS when file capture + claim fields match two-message design", () => {
    const state = createLiveHookPreflightState();
    const handlers: Record<
      string,
      (e: Record<string, unknown>, c: Record<string, unknown>) => unknown
    > = {};
    const logs: string[] = [];
    registerLiveHookPreflight(
      {
        logger: { info: (m) => logs.push(m) },
        on: (hook, handler) => {
          handlers[hook] = handler;
        },
      },
      state,
    );

    handlers.message_received?.(
      {
        messageId: "m1",
        sessionKey: "s1",
        accountId: "a1",
        peerId: "p1",
        senderId: "u1",
        media: [{ path: "/tmp/inbound/f.csv", contentType: "text/csv" }],
      },
      {},
    );
    handlers.before_prompt_build?.(
      { sessionKey: "s1", peerId: "p1", runId: "r-instr" },
      {},
    );
    handlers.before_tool_call?.(
      { sessionKey: "s1", peerId: "p1", runId: "r-instr" },
      {},
    );

    const verdict = evaluatePreflightPass(state);
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toBe("two_message_preflight_pass");

    for (const line of logs) {
      expect(line).not.toMatch(/m1|s1|a1|p1|u1|r-instr|\/tmp|\.csv/);
    }
    const fileLine = logs.find((l) => l.includes("hook=message_received"));
    expect(fileLine).toBeTruthy();
    for (const key of FILE_CAPTURE_IDENTITY_FIELDS) {
      expect(fileLine!).toContain(key);
    }
    expect(fileLine!).toContain("qualifying_media_present");
    expect(fileLine!).toContain("staged_media_path_present");
  });

  it("preserves qualifying file snapshot across text-only follow-up", () => {
    const state = createLiveHookPreflightState();
    const handlers: Record<
      string,
      (e: Record<string, unknown>, c: Record<string, unknown>) => unknown
    > = {};
    registerLiveHookPreflight(
      {
        on: (hook, handler) => {
          handlers[hook] = handler;
        },
      },
      state,
    );

    handlers.message_received?.(
      {
        messageId: "m1",
        sessionKey: "s1",
        accountId: "a1",
        peerId: "p1",
        senderId: "u1",
        media: [{ path: "/tmp/inbound/f.csv", contentType: "text/csv" }],
      },
      {},
    );
    handlers.message_received?.(
      {
        messageId: "m2",
        sessionKey: "s1",
        accountId: "a1",
        peerId: "p1",
        senderId: "u1",
        media: [],
      },
      {},
    );
    handlers.before_prompt_build?.(
      { sessionKey: "s1", peerId: "p1", runId: "r1" },
      {},
    );
    handlers.before_tool_call?.(
      { sessionKey: "s1", peerId: "p1", runId: "r1" },
      {},
    );

    expect(state.qualifyingFileSnapshot?.mediaFlags.qualifying_media_present).toBe(
      true,
    );
    expect(evaluatePreflightPass(state).pass).toBe(true);
  });

  it("log lines never embed secret values or paths", () => {
    const snap = scanHookFieldPresence(
      "message_received",
      {
        messageId: "SECRET-MSG",
        sessionKey: "agent:owner:main",
        accountId: "SECRET-ACCT",
        peerId: "SECRET-PEER",
        senderId: "SECRET-SENDER",
        media: [{ path: "/secret/path.xlsx", contentType: "text/csv" }],
      },
      {},
    );
    const line = formatPresenceLogLine(snap);
    expect(line).not.toContain("SECRET");
    expect(line).not.toContain("/secret");
    expect(line).not.toContain(".xlsx");
    for (const f of MEDIA_FLAG_FIELDS) {
      if (f !== "media_staging_pending") expect(line).toContain(f);
    }
  });

  it("claim hooks only require CLAIM_TURN fields", () => {
    const snap = scanHookFieldPresence(
      "before_prompt_build",
      { sessionKey: "s1", peerId: "p1", runId: "r1" },
      {},
    );
    for (const f of CLAIM_TURN_IDENTITY_FIELDS) {
      expect(snap.identityPresent[f]).toBe(true);
    }
    expect(snap.absentNames).not.toContain("runId");
  });
});

describe("registration gates", () => {
  it("requires explicit enablement", () => {
    expect(isPreflightExplicitlyEnabled({})).toBe(false);
    expect(
      isPreflightExplicitlyEnabled({ WAM_LIVE_HOOK_PREFLIGHT_ENABLED: "1" }),
    ).toBe(true);
    const result = tryRegisterPreflightPlugin(
      { logger: { warn() {} } },
      { OPENCLAW_VERSION: "2026.7.1-2" },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("explicit_enablement_required");
  });

  it("fail closed on unsupported OpenClaw version", () => {
    expect(assertOpenClawVersion("2025.1.0").ok).toBe(false);
    const result = tryRegisterPreflightPlugin(
      { logger: { warn() {}, info() {} } },
      {
        WAM_LIVE_HOOK_PREFLIGHT_ENABLED: "1",
        OPENCLAW_VERSION: "999.0.0",
      },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("openclaw_version_unsupported");
  });

  it("registers when enabled and version guarded", () => {
    const result = tryRegisterPreflightPlugin(
      {
        logger: { warn() {}, info() {} },
        on() {},
      },
      {
        WAM_LIVE_HOOK_PREFLIGHT_ENABLED: "1",
        OPENCLAW_VERSION: "2026.7.1-2",
      },
    );
    expect(result.ok).toBe(true);
  });
});
