import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelegramIngressFixture } from "../fixtures/telegram-ingress.js";
import { processMessageReceivedSequence } from "../src/message-sequence.js";
import { CapabilityStore } from "../src/capability-store.js";
import { createMockMcpBridge } from "../src/testing.js";
import { revalidateBindingFile } from "../src/capability-mint.js";
import {
  executeWrapperTool,
  shouldBlockRawDocumentTool,
  redactHostPaths,
  toSafeToolPayload,
} from "../src/wrapper-tools.js";
import {
  assertOpenClawVersion,
  resolveOpenClawVersion,
} from "../src/version-guard.js";
import {
  createAdapterRuntime,
  createTestAdapterRuntime,
  registerAttachmentAdapter,
  turnFromCtx,
  type PluginApiLike,
} from "../src/index.js";
import {
  syncHandshakeForTurn,
  bindingUsableForTools,
} from "../src/handshake.js";
import type { TurnIdentity } from "../src/types.js";
import { PENDING_TTL_MS } from "../src/types.js";
import { OPENCLAW_HOOK_ORDERING_PROOF as PROOF } from "../src/openclaw-hook-proof.js";

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
  // Stock OpenClaw: instruction claim uses unpatched ctx (no messageId).
  const ctx =
    kind === "file" ? fx.fileTurnCtx : fx.unpatchedInstructionTurnCtx;
  return { ...turnFromCtx({}, ctx, "bonface-owner"), ...overrides };
}

describe("OpenClaw version guard (no core patch)", () => {
  it("accepts 2026.7.1-2", () => {
    expect(assertOpenClawVersion("2026.7.1-2").ok).toBe(true);
  });
  it("plugin-only sequence binding is ACCEPTED", () => {
    expect(PROOF.pluginOnly).toBe("ACCEPTED_SEQUENCE_BINDING");
    expect(PROOF.corePatchRequired).toBeNull();
    expect(PROOF.adapterVersion).toBe("0.2.2");
    expect(PROOF.toolGate).toBe(
      "always_catalogued_wrappers_execute_late_claim",
    );
  });
  it("resolveOpenClawVersion prefers OPENCLAW_VERSION env", () => {
    expect(
      resolveOpenClawVersion({
        env: { OPENCLAW_VERSION: "2026.7.1-2" },
        apiConfig: { version: "ignored" },
      }),
    ).toBe("2026.7.1-2");
  });
});

describe("v0.2.2 live order: file MR → instruction MR → one BPB → wrappers → consume", () => {
  let fx: ReturnType<typeof createTelegramIngressFixture>;
  let store: CapabilityStore;

  beforeEach(() => {
    fx = createTelegramIngressFixture();
    store = new CapabilityStore();
  });
  afterEach(() => fx.cleanup());

  it("full happy path with stock (no messageId) claim", async () => {
    expect(capture(store, fx).status).toBe("pending");
    expect(observeInstruction(store, fx).status).toBe("instruction_observed");
    const pending = store.getPending(fx.fixture.sessionKey)!;
    expect(pending.lifecycle).toBe("instruction_observed");

    // File BPB before observe would not claim — already observed here.
    // Sole subsequent BPB (stock unpatched ctx) claims.
    const hs = syncHandshakeForTurn(store, promptTurn(fx, "instruction"));
    expect(hs.claimed).toBe(true);
    expect(hs.phase).toBe("claimed");

    const turn = promptTurn(fx, "instruction");
    const bridge = createMockMcpBridge(async (req) => {
      const table: Record<string, unknown> = {
        inspect_business_document: {
          sheet_name: "Sheet1",
          row_estimate: 2,
          path: "/home/bonface/.openclaw/media/inbound/secret.csv",
        },
        parse_document_customers: { customers: 1 },
        reconcile_document_customers: { reconciled: 1 },
      };
      return { ok: true, data: table[req.tool] ?? {} };
    });

    const inspect = await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge,
      turn,
    });
    expect(inspect.ok).toBe(true);
    const doc = (inspect.data as { document: Record<string, unknown> }).document;
    expect(doc.filename).toBe("synthetic-customers.csv");
    expect(doc.type).toBe("csv");
    expect(doc.sheet_name).toBe("Sheet1");
    expect(doc.row_estimate).toBe(2);
    expect(JSON.stringify(inspect.data)).not.toMatch(/\/home\//);
    expect(JSON.stringify(inspect.data)).not.toMatch(/wam-attcap-/);

    expect(
      (
        await executeWrapperTool({
          tool: "parse_current_document_customers",
          store,
          bridge,
          turn,
        })
      ).ok,
    ).toBe(true);

    const rec = await executeWrapperTool({
      tool: "reconcile_current_document_customers",
      store,
      bridge,
      turn,
    });
    expect(rec.ok).toBe(true);
    expect(store.getRaw(fx.fixture.sessionKey)).toBeNull();
    expect(store.getActiveForSession(fx.fixture.sessionKey)).toBeNull();
  });

  it("file BPB without following instruction does not claim", () => {
    capture(store, fx);
    const hs = syncHandshakeForTurn(store, promptTurn(fx, "file"));
    expect(hs.claimed).toBe(false);
    expect(hs.phase).toBe("pending_file_ack");
    expect(bindingUsableForTools(store, promptTurn(fx, "file"))).toBeNull();
  });

  it("identity mismatch invalidates", () => {
    capture(store, fx);
    observeInstruction(store, fx);
    const hs = syncHandshakeForTurn(
      store,
      promptTurn(fx, "instruction", { peerId: "9999" }),
    );
    expect(hs.claimed).toBe(false);
    expect(hs.reason).toBe("peer_mismatch");
    expect(store.getPending(fx.fixture.sessionKey)).toBeNull();
  });

  it("second intervening text message invalidates", () => {
    capture(store, fx);
    observeInstruction(store, fx);
    const third = {
      ...fx.nextTextEvent,
      messageId: "44",
    };
    const r = observeInstruction(store, fx, third);
    expect(r.status).toBe("invalidated");
    expect(store.getPending(fx.fixture.sessionKey)).toBeNull();
  });

  it("newer file replaces older pending", () => {
    capture(store, fx);
    const first = store.getPending(fx.fixture.sessionKey)!.fileMessageId;
    const fx2 = createTelegramIngressFixture({
      sessionKey: fx.fixture.sessionKey,
      fileName: "replacement.csv",
    });
    // Same session roots: use fx2 file under its root — need shared root.
    // Put replacement into same rootDir as fx.
    const replacement = path.join(fx.fixture.rootDir, "inbound", "replacement.csv");
    fs.writeFileSync(replacement, "a,b\n1,2\n");
    const staged = {
      ...fx.stagedEvent,
      messageId: "99",
      media: [{ path: replacement, contentType: "text/csv", kind: "document" }],
    };
    const r = processMessageReceivedSequence(store, staged, {
      agentId: "bonface-owner",
      attachmentRoots: [fx.fixture.rootDir],
    });
    expect(r.status).toBe("pending");
    const pending = store.getPending(fx.fixture.sessionKey)!;
    expect(pending.fileMessageId).toBe("99");
    expect(pending.fileMessageId).not.toBe(first);
    expect(pending.instructionObserved).toBe(false);
    fx2.cleanup();
  });

  it("TTL expiry fails closed", () => {
    capture(store, fx);
    const now = Date.now();
    const b = store.getRaw(fx.fixture.sessionKey)!;
    b.expiresAtMs = now - 1;
    expect(store.getPending(fx.fixture.sessionKey, now)).toBeNull();
  });

  it("/new / session reset clears binding", () => {
    capture(store, fx);
    observeInstruction(store, fx);
    store.onSessionReset(fx.fixture.sessionKey);
    expect(store.getPending(fx.fixture.sessionKey)).toBeNull();
  });

  it("gateway/store restart clears all state", () => {
    capture(store, fx);
    store.clear();
    expect(store.getPending(fx.fixture.sessionKey)).toBeNull();
  });

  it("changed file fails revalidation", async () => {
    capture(store, fx);
    observeInstruction(store, fx);
    syncHandshakeForTurn(store, promptTurn(fx, "instruction"));
    const turn = promptTurn(fx, "instruction");
    fs.writeFileSync(fx.fixture.downloadedPath, "tampered\n");
    const bridge = createMockMcpBridge(async () => ({ ok: true, data: {} }));
    const r = await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge,
      turn,
    });
    expect(r.ok).toBe(false);
    expect(r.denied || r.error).toBeTruthy();
  });

  it("symlink / outside-root rejection", () => {
    const outside = path.join(fx.fixture.rootDir, "..", "escape.csv");
    fs.writeFileSync(outside, "x\n");
    const staged = {
      ...fx.stagedEvent,
      media: [{ path: outside, contentType: "text/csv", kind: "document" }],
    };
    const r = processMessageReceivedSequence(store, staged, {
      agentId: "bonface-owner",
      attachmentRoots: [fx.fixture.rootDir],
    });
    expect(r.status).toBe("error");
  });

  it("duplicate staged fingerprint across sessions fails closed", () => {
    capture(store, fx);
    const other = new CapabilityStore();
    // Manually seed other store isn't needed — use same store, different session
    // pointing at same inode via hardlink if possible; on Windows hardlinks may fail.
    // Instead: capture same path into second session by copying same device/inode
    // through a second put of identical lstat identity in another sessionKey.
    const stagedOther = {
      ...fx.stagedEvent,
      sessionKey: "agent:bonface-owner:telegram:peer-other",
      messageId: "77",
      peerId: "2002",
      senderId: "2002",
    };
    const r = processMessageReceivedSequence(store, stagedOther, {
      agentId: "bonface-owner",
      attachmentRoots: [fx.fixture.rootDir],
    });
    // Same file path = same device:inode:size → duplicate
    expect(r.status).toBe("error");
    expect((r as { reason?: string }).reason).toBe(
      "duplicate_staged_fingerprint",
    );
    void other;
  });

  it("raw document tools blocked; wrappers one-use after reconcile", async () => {
    expect(shouldBlockRawDocumentTool("wam.business.documents.read")).toBe(
      true,
    );
    capture(store, fx);
    observeInstruction(store, fx);
    syncHandshakeForTurn(store, promptTurn(fx, "instruction"));
    const turn = promptTurn(fx, "instruction");
    const bridge = createMockMcpBridge(async () => ({
      ok: true,
      data: { row_estimate: 1 },
    }));
    await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge,
      turn,
    });
    await executeWrapperTool({
      tool: "parse_current_document_customers",
      store,
      bridge,
      turn,
    });
    await executeWrapperTool({
      tool: "reconcile_current_document_customers",
      store,
      bridge,
      turn,
    });
    expect(bindingUsableForTools(store, turn)).toBeNull();
  });

  it("no implicit newest-file reuse after consume", async () => {
    capture(store, fx);
    observeInstruction(store, fx);
    syncHandshakeForTurn(store, promptTurn(fx, "instruction"));
    const turn = promptTurn(fx, "instruction");
    const bridge = createMockMcpBridge(async () => ({ ok: true, data: {} }));
    await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge,
      turn,
    });
    await executeWrapperTool({
      tool: "parse_current_document_customers",
      store,
      bridge,
      turn,
    });
    await executeWrapperTool({
      tool: "reconcile_current_document_customers",
      store,
      bridge,
      turn,
    });
    // Same file still on disk — must not auto-bind without new MR sequence.
    expect(store.getPending(fx.fixture.sessionKey)).toBeNull();
    const hs = syncHandshakeForTurn(store, promptTurn(fx, "instruction", {
      runId: "run-new",
    }));
    expect(hs.claimed).toBe(false);
  });

  it("identical bytes under two roots: content digested at most once", async () => {
    const bytes =
      "Customer Name,Airtel Phone,Installed\nDup A,254711890099,installed\n";
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "wam-root-a-"));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "wam-root-b-"));
    const inboundA = path.join(rootA, "inbound");
    const inboundB = path.join(rootB, "media", "inbound");
    fs.mkdirSync(inboundA, { recursive: true });
    fs.mkdirSync(inboundB, { recursive: true });
    const pathA = path.join(inboundA, "customers.csv");
    const pathB = path.join(inboundB, "customers.csv");
    fs.writeFileSync(pathA, bytes);
    fs.writeFileSync(pathB, bytes);
    const stA = fs.lstatSync(pathA);
    const stB = fs.lstatSync(pathB);
    expect(pathA).not.toBe(pathB);
    expect(String(stA.ino)).not.toBe(String(stB.ino));
    expect(stA.size).toBe(stB.size);

    const sessionA = "agent:bonface-owner:telegram:peer-dup-a";
    const sessionB = "agent:bonface-owner:telegram:peer-dup-b";
    const fxA = createTelegramIngressFixture({
      sessionKey: sessionA,
      contents: bytes,
      fileName: "customers.csv",
    });
    // Replace fixture path with our dual-root files
    fs.writeFileSync(fxA.fixture.downloadedPath, bytes);
    const eventA = {
      ...fxA.stagedEvent,
      media: [{ path: pathA, contentType: "text/csv", kind: "document" }],
    };
    const eventBBase = createTelegramIngressFixture({
      sessionKey: sessionB,
      contents: "placeholder",
      fileName: "other.csv",
    });
    const eventB = {
      ...eventBBase.stagedEvent,
      messageId: "99",
      peerId: "9002",
      senderId: "9002",
      media: [{ path: pathB, contentType: "text/csv", kind: "document" }],
    };

    expect(
      processMessageReceivedSequence(store, eventA, {
        agentId: "bonface-owner",
        attachmentRoots: [rootA, rootB],
      }).status,
    ).toBe("pending");
    expect(
      processMessageReceivedSequence(store, eventB, {
        agentId: "bonface-owner",
        attachmentRoots: [rootA, rootB],
      }).status,
    ).toBe("pending");

    // Different inodes → both can be pending (inode gate alone would miss this).
    expect(store.getPending(sessionA)).toBeTruthy();
    expect(store.getPending(sessionB)).toBeTruthy();

    const observe = (sessionKey: string, peer: string, mid: string) =>
      processMessageReceivedSequence(
        store,
        {
          mediaStagingPending: false,
          messageId: mid,
          sessionKey,
          senderId: peer,
          accountId: "bonface-telegram",
          peerId: peer,
          media: [],
        },
        { agentId: "bonface-owner", attachmentRoots: [rootA, rootB] },
      );

    expect(observe(sessionA, "1001", "43").status).toBe("instruction_observed");
    expect(observe(sessionB, "9002", "100").status).toBe("instruction_observed");

    const turnA: TurnIdentity = {
      sessionKey: sessionA,
      runId: "run-a",
      messageId: null,
      accountId: "bonface-telegram",
      peerId: "1001",
      senderId: "1001",
      agentId: "bonface-owner",
      sessionGeneration: null,
    };
    const turnB: TurnIdentity = {
      ...turnA,
      sessionKey: sessionB,
      runId: "run-b",
      peerId: "9002",
      senderId: "9002",
    };
    expect(syncHandshakeForTurn(store, turnA).claimed).toBe(true);
    expect(syncHandshakeForTurn(store, turnB).claimed).toBe(true);

    let mcpCalls = 0;
    const bridge = createMockMcpBridge(async () => {
      mcpCalls += 1;
      return { ok: true, data: { sheet_name: "Sheet1", row_estimate: 1 } };
    });

    const first = await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge,
      turn: turnA,
    });
    expect(first.ok).toBe(true);
    expect(mcpCalls).toBe(1);

    const second = await executeWrapperTool({
      tool: "inspect_current_business_document",
      store,
      bridge,
      turn: turnB,
    });
    expect(second.ok).toBe(false);
    expect(second.error?.category).toBe("duplicate_content_digest");
    // Second must not reach MCP parse/reconcile either
    expect(mcpCalls).toBe(1);

    const parseB = await executeWrapperTool({
      tool: "parse_current_document_customers",
      store,
      bridge,
      turn: turnB,
    });
    expect(parseB.ok).toBe(false);
    expect(mcpCalls).toBe(1);

    fxA.cleanup();
    eventBBase.cleanup();
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  });

  it("same size different content is not treated as content duplicate", async () => {
    const pad = (s: string) => s.padEnd(64, "X");
    const a = pad("Customer Name,Airtel Phone,Installed\nA,1,installed\n");
    const b = pad("Customer Name,Airtel Phone,Installed\nB,2,installed\n");
    expect(Buffer.byteLength(a)).toBe(Buffer.byteLength(b));
    expect(a).not.toBe(b);

    const fx1 = createTelegramIngressFixture({
      sessionKey: "agent:bonface-owner:telegram:peer-sz-1",
      contents: a,
      fileName: "a.csv",
    });
    const fx2 = createTelegramIngressFixture({
      sessionKey: "agent:bonface-owner:telegram:peer-sz-2",
      contents: b,
      fileName: "b.csv",
    });
    const roots = [fx1.fixture.rootDir, fx2.fixture.rootDir];

    expect(
      processMessageReceivedSequence(store, fx1.stagedEvent, {
        agentId: "bonface-owner",
        attachmentRoots: roots,
      }).status,
    ).toBe("pending");
    expect(
      processMessageReceivedSequence(store, fx2.stagedEvent, {
        agentId: "bonface-owner",
        attachmentRoots: roots,
      }).status,
    ).toBe("pending");

    processMessageReceivedSequence(store, fx1.nextTextEvent, {
      agentId: "bonface-owner",
      attachmentRoots: roots,
    });
    processMessageReceivedSequence(
      store,
      {
        ...fx2.nextTextEvent,
        messageId: "55",
        peerId: fx2.fixture.peer,
        senderId: fx2.fixture.sender,
      },
      { agentId: "bonface-owner", attachmentRoots: roots },
    );

    const turn1 = {
      ...promptTurn(fx1, "instruction"),
      sessionKey: fx1.fixture.sessionKey,
      peerId: fx1.fixture.peer,
      senderId: fx1.fixture.sender,
      runId: "run-sz-1",
    };
    const turn2 = {
      ...promptTurn(fx2, "instruction"),
      sessionKey: fx2.fixture.sessionKey,
      peerId: fx2.fixture.peer,
      senderId: fx2.fixture.sender,
      runId: "run-sz-2",
    };
    expect(syncHandshakeForTurn(store, turn1).claimed).toBe(true);
    expect(syncHandshakeForTurn(store, turn2).claimed).toBe(true);

    const bridge = createMockMcpBridge(async () => ({
      ok: true,
      data: { row_estimate: 1 },
    }));
    expect(
      (
        await executeWrapperTool({
          tool: "inspect_current_business_document",
          store,
          bridge,
          turn: turn1,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await executeWrapperTool({
          tool: "inspect_current_business_document",
          store,
          bridge,
          turn: turn2,
        })
      ).ok,
    ).toBe(true);

    fx1.cleanup();
    fx2.cleanup();
  });

  it("PENDING_TTL_MS is 120 seconds", () => {
    expect(PENDING_TTL_MS).toBe(120_000);
  });

  it("redactHostPaths strips home paths", () => {
    const r = redactHostPaths({ p: "/home/bonface/secret.csv" });
    expect(JSON.stringify(r)).not.toMatch(/\/home\/bonface/);
  });
});

describe("registration without core patch", () => {
  it("registers on stock OpenClaw when version ok", () => {
    const hooks: string[] = [];
    const api: PluginApiLike = {
      on: (h) => {
        hooks.push(h);
      },
      registerTool: () => {},
      logger: {},
    };
    const runtime = createTestAdapterRuntime({
      bridge: createMockMcpBridge({}),
      openclawVersion: "2026.7.1-2",
    });
    const r = registerAttachmentAdapter(api, runtime);
    expect(r.ok).toBe(true);
    expect(hooks).toContain("message_received");
    expect(hooks).toContain("before_prompt_build");
  });

  it("createAdapterRuntime rejects missing roots", () => {
    expect(() =>
      createAdapterRuntime({
        bridge: { kind: "stdio", callDocumentTool: async () => ({ ok: true }) } as never,
        attachmentRoots: [],
      }),
    ).toThrow(/attachment_roots_required/);
  });
});

// silence unused
void toSafeToolPayload;
void revalidateBindingFile;
