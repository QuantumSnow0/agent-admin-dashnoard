import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createTelegramIngressFixture } from "../fixtures/telegram-ingress.js";
import { processMessageReceivedSequence } from "../src/message-sequence.js";
import { CapabilityStore } from "../src/capability-store.js";
import { createMockMcpBridge } from "../src/testing.js";
import { executeWrapperTool, shouldBlockRawDocumentTool } from "../src/wrapper-tools.js";
import {
  createTestAdapterRuntime,
  registerAttachmentAdapter,
  turnFromCtx,
  type PluginApiLike,
} from "../src/index.js";
import {
  syncHandshakeForTurn,
  bindingUsableForTools,
  resolveBindingForToolsAsync,
} from "../src/handshake.js";
import {
  INSTRUCTION_OBSERVE_WAIT_MS,
  WRAPPER_TOOL_NAMES,
  type TurnIdentity,
} from "../src/types.js";
import { buildPendingRacePromptHint } from "../src/attachment-capture.js";

function capture(
  store: CapabilityStore,
  fx: ReturnType<typeof createTelegramIngressFixture>,
) {
  return processMessageReceivedSequence(store, fx.stagedEvent, {
    agentId: "bonface-owner",
    attachmentRoots: [fx.fixture.rootDir],
  });
}

function observeInstruction(
  store: CapabilityStore,
  fx: ReturnType<typeof createTelegramIngressFixture>,
  event?: Record<string, unknown>,
) {
  return processMessageReceivedSequence(store, event ?? fx.nextTextEvent, {
    agentId: "bonface-owner",
    attachmentRoots: [fx.fixture.rootDir],
  });
}

function promptTurn(
  fx: ReturnType<typeof createTelegramIngressFixture>,
  kind: "file" | "instruction",
  overrides: Partial<TurnIdentity> = {},
): TurnIdentity {
  const ctx =
    kind === "file" ? fx.fileTurnCtx : fx.unpatchedInstructionTurnCtx;
  return { ...turnFromCtx({}, ctx, "bonface-owner"), ...overrides };
}

describe("v0.2.2 live race: instruction BPB before instruction MR", () => {
  let fx: ReturnType<typeof createTelegramIngressFixture>;
  let store: CapabilityStore;

  beforeEach(() => {
    fx = createTelegramIngressFixture();
    store = new CapabilityStore();
  });
  afterEach(() => fx.cleanup());

  it("exact regression: wrappers catalogued before observe; late-claim inspect→parse→reconcile→consumed", async () => {
    expect(capture(store, fx).status).toBe("pending");

    const fileHs = syncHandshakeForTurn(store, promptTurn(fx, "file"));
    expect(fileHs.claimed).toBe(false);
    expect(fileHs.prependContext).toContain("may be pending");
    expect(fileHs.prependContext).toContain("inspect_current_business_document");

    // Instruction BPB / tool catalogue BEFORE instruction message_received finishes.
    type ToolFactory = (
      ctx: Record<string, unknown>,
    ) => Record<string, unknown> | null;
    const factories: ToolFactory[] = [];
    const api: PluginApiLike = {
      on: () => {},
      registerTool: (factory) => {
        if (typeof factory === "function") factories.push(factory as ToolFactory);
      },
      logger: {},
    };
    const runtime = createTestAdapterRuntime({
      bridge: createMockMcpBridge({}),
      openclawVersion: "2026.7.1-2",
      store,
      attachmentRoots: [fx.fixture.rootDir],
    });
    expect(registerAttachmentAdapter(api, runtime).ok).toBe(true);
    expect(factories.length).toBe(WRAPPER_TOOL_NAMES.length);

    const instructionTurn = promptTurn(fx, "instruction");
    const toolCtx = {
      sessionKey: instructionTurn.sessionKey,
      runId: instructionTurn.runId,
      peerId: instructionTurn.peerId,
      accountId: instructionTurn.accountId,
      senderId: instructionTurn.senderId,
    };

    // Catalogue must expose wrappers even though instruction_observed is false.
    expect(store.getPending(fx.fixture.sessionKey)?.instructionObserved).toBe(
      false,
    );
    const descriptors = factories.map((f) => f(toolCtx));
    expect(descriptors.every((d) => d != null)).toBe(true);
    expect(descriptors.map((d) => d!.name)).toEqual([...WRAPPER_TOOL_NAMES]);
    expect(bindingUsableForTools(store, instructionTurn)).toBeNull();

    const instrHs = syncHandshakeForTurn(store, instructionTurn);
    expect(instrHs.claimed).toBe(false);
    expect(instrHs.prependContext).toBe(buildPendingRacePromptHint());

    // Now instruction message_received completes.
    expect(observeInstruction(store, fx).status).toBe("instruction_observed");
    expect(store.getPending(fx.fixture.sessionKey)?.lifecycle).toBe(
      "instruction_observed",
    );

    const bridge = createMockMcpBridge(async (req) => {
      const table: Record<string, unknown> = {
        inspect_business_document: { sheet_name: "Sheet1", row_estimate: 2 },
        parse_document_customers: { customers: 1 },
        reconcile_document_customers: { reconciled: 1 },
      };
      return { ok: true, data: table[req.tool] ?? {} };
    });

    const inspect = await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge,
      turn: instructionTurn,
    });
    expect(inspect.ok).toBe(true);
    expect(store.getActiveForSession(fx.fixture.sessionKey)?.instructionRunId).toBe(
      instructionTurn.runId,
    );

    expect(
      (
        await executeWrapperTool({
          tool: "parse_current_document_customers",
          store,
          bridge,
          turn: instructionTurn,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await executeWrapperTool({
          tool: "reconcile_current_document_customers",
          store,
          bridge,
          turn: instructionTurn,
        })
      ).ok,
    ).toBe(true);
    expect(store.getActiveForSession(fx.fixture.sessionKey)).toBeNull();
    expect(store.getPending(fx.fixture.sessionKey)).toBeNull();
  });

  it("tool execute before observation succeeds if observe completes within wait", async () => {
    capture(store, fx);
    const turn = promptTurn(fx, "instruction");
    const bridge = createMockMcpBridge(async () => ({
      ok: true,
      data: { row_estimate: 1 },
    }));

    const execPromise = executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge,
      turn,
      observeWaitMs: 400,
      observePollMs: 20,
    });

    await new Promise((r) => setTimeout(r, 40));
    expect(observeInstruction(store, fx).status).toBe("instruction_observed");

    const r = await execPromise;
    expect(r.ok).toBe(true);
  });

  it("observation never completes -> wait_timeout fail closed", async () => {
    capture(store, fx);
    const turn = promptTurn(fx, "instruction");
    const r = await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge: createMockMcpBridge({}),
      turn,
      observeWaitMs: 80,
      observePollMs: 20,
    });
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe("wait_timeout");
    expect(INSTRUCTION_OBSERVE_WAIT_MS).toBe(500);
  });

  it("wrong identity during wait fail closed", async () => {
    capture(store, fx);
    const turn = promptTurn(fx, "instruction");
    const execPromise = executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge: createMockMcpBridge({}),
      turn,
      observeWaitMs: 300,
      observePollMs: 20,
    });
    await new Promise((r) => setTimeout(r, 30));
    // Intervening observe with wrong peer invalidates pending.
    processMessageReceivedSequence(
      store,
      {
        ...fx.nextTextEvent,
        peerId: "9999",
        senderId: "9999",
      },
      {
        agentId: "bonface-owner",
        attachmentRoots: [fx.fixture.rootDir],
      },
    );
    const r = await execPromise;
    expect(r.ok).toBe(false);
    expect(["peer_mismatch", "no_pending", "wait_timeout"]).toContain(
      r.error?.category,
    );
  });

  it("stale/third text during wait fail closed", async () => {
    capture(store, fx);
    // First instruction observes
    observeInstruction(store, fx);
    // Second intervening text invalidates
    const second = processMessageReceivedSequence(
      store,
      {
        ...fx.nextTextEvent,
        messageId: "999",
      },
      {
        agentId: "bonface-owner",
        attachmentRoots: [fx.fixture.rootDir],
      },
    );
    expect(second.status).toBe("invalidated");

    const r = await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge: createMockMcpBridge({}),
      turn: promptTurn(fx, "instruction"),
      observeWaitMs: 50,
      observePollMs: 10,
    });
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe("no_pending");
  });

  it("wrappers always visible but cannot access file without valid sequence", async () => {
    type ToolFactory = (
      ctx: Record<string, unknown>,
    ) => Record<string, unknown> | null;
    const factories: ToolFactory[] = [];
    const api: PluginApiLike = {
      on: () => {},
      registerTool: (factory) => {
        if (typeof factory === "function") factories.push(factory as ToolFactory);
      },
      logger: {},
    };
    registerAttachmentAdapter(
      api,
      createTestAdapterRuntime({
        bridge: createMockMcpBridge({}),
        openclawVersion: "2026.7.1-2",
        store,
      }),
    );
    const desc = factories[0]!({
      sessionKey: "agent:bonface-owner:telegram:peer-x",
      runId: "run-x",
      peerId: "x",
    });
    expect(desc).not.toBeNull();
    expect(desc!.name).toBe("inspect_current_business_document");

    const r = await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge: createMockMcpBridge({}),
      turn: {
        sessionKey: "agent:bonface-owner:telegram:peer-x",
        runId: "run-x",
        messageId: null,
        accountId: "a",
        peerId: "x",
        senderId: "x",
        agentId: "bonface-owner",
        sessionGeneration: null,
      },
      observeWaitMs: 40,
      observePollMs: 10,
    });
    expect(r.ok).toBe(false);
    expect(r.denied).toBe(true);
  });

  it("raw document tools remain blocked", () => {
    expect(
      shouldBlockRawDocumentTool(
        "wam.business.documents.inspect_business_document",
      ),
    ).toBe(true);
  });

  it("resolveBindingForToolsAsync late-claims after observe", async () => {
    capture(store, fx);
    const turn = promptTurn(fx, "instruction");
    vi.useFakeTimers();
    const p = resolveBindingForToolsAsync(store, turn, {
      maxWaitMs: 200,
      pollMs: 25,
    });
    await vi.advanceTimersByTimeAsync(30);
    observeInstruction(store, fx);
    await vi.advanceTimersByTimeAsync(50);
    const r = await p;
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lateClaim).toBe(true);
      expect(r.binding.instructionRunId).toBe(turn.runId);
    }
  });
});
