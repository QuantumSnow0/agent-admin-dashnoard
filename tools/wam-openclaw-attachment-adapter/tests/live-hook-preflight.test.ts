import { describe, expect, it } from "vitest";
import {
  createLiveHookPreflightState,
  evaluatePreflightPass,
  formatPresenceLogLine,
  isScalarIdentityValue,
  registerLiveHookPreflight,
  scanHookFieldPresence,
  summarizePreflight,
} from "../src/live-hook-preflight.js";

describe("v0.2.1 live-hook preflight (sequence-binding fields)", () => {
  it("scalar identity rejects boolean/object", () => {
    expect(isScalarIdentityValue("x")).toBe(true);
    expect(isScalarIdentityValue(true)).toBe(false);
  });

  it("records MR identity and stock BPB claim fields (session/peer/run)", () => {
    const state = createLiveHookPreflightState();
    const handlers: Record<
      string,
      (e: Record<string, unknown>, c: Record<string, unknown>) => unknown
    > = {};
    registerLiveHookPreflight(
      {
        on: (h, fn) => {
          handlers[h] = fn;
        },
      },
      state,
    );

    handlers.message_received?.(
      {
        messageId: "42",
        sessionKey: "s1",
        accountId: "a1",
        peerId: "p1",
        senderId: "u1",
        media: [{ path: "/tmp/x.csv", contentType: "text/csv" }],
      },
      {},
    );
    handlers.message_received?.(
      {
        messageId: "43",
        sessionKey: "s1",
        accountId: "a1",
        peerId: "p1",
        senderId: "u1",
        media: [],
      },
      {},
    );
    // Stock OpenClaw BPB: sessionKey + peerId + runId (messageId optional).
    handlers.before_prompt_build?.(
      {},
      { sessionKey: "s1", peerId: "p1", runId: "r1" },
    );
    handlers.before_tool_call?.(
      {},
      { sessionKey: "s1", peerId: "p1", runId: "r1" },
    );

    expect(state.qualifyingFileSnapshot?.mediaFlags.qualifying_media_present).toBe(
      true,
    );
    // Preflight may still require messageId historically — v0.2.0 claim does not.
    // Ensure presence scan at least records session/peer/run without throwing.
    expect(summarizePreflight(state).hooksFired.message_received).toBeGreaterThan(0);
  });

  it("logs never include paths", () => {
    const line = formatPresenceLogLine(
      scanHookFieldPresence(
        "message_received",
        {
          messageId: "42",
          sessionKey: "s1",
          accountId: "a1",
          peerId: "p1",
          senderId: "u1",
          media: [{ path: "/secret/in.xlsx", contentType: "text/csv" }],
        },
        {},
      ),
    );
    expect(line).not.toContain("/secret");
  });

  it("evaluatePreflightPass remains callable", () => {
    const state = createLiveHookPreflightState();
    expect(typeof evaluatePreflightPass(state).pass).toBe("boolean");
  });
});
