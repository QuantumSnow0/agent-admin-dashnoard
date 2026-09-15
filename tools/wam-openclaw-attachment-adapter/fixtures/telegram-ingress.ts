import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Synthetic Telegram ingress for adapter v0.2.0 on stock OpenClaw 2026.7.1-2:
 * - message_received: messageId/sessionKey/accountId/peerId/senderId (no runId)
 * - before_prompt_build: sessionKey/peerId/runId (messageId typically absent)
 */
export type TelegramIngressFixture = {
  message_id: number;
  account: string;
  peer: string;
  sender: string;
  document: { mime_type: string; file_name: string };
  downloadedPath: string;
  rootDir: string;
  sessionKey: string;
  fileRunId: string;
  instructionRunId: string;
  instructionMessageId: string;
};

export function createTelegramIngressFixture(opts?: {
  fileName?: string;
  contents?: string;
  sessionKey?: string;
}): {
  fixture: TelegramIngressFixture;
  cleanup: () => void;
  pendingEvent: Record<string, unknown>;
  stagedEvent: Record<string, unknown>;
  nextTextEvent: Record<string, unknown>;
  fileTurnCtx: Record<string, unknown>;
  instructionTurnCtx: Record<string, unknown>;
  /** Stock OpenClaw prompt shape (no messageId) — primary claim path for v0.2.0. */
  unpatchedInstructionTurnCtx: Record<string, unknown>;
} {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "wam-tg-root-"));
  const inbound = path.join(rootDir, "inbound");
  fs.mkdirSync(inbound);
  const fileName = opts?.fileName ?? "synthetic-customers.csv";
  const downloadedPath = path.join(inbound, fileName);
  fs.writeFileSync(
    downloadedPath,
    opts?.contents ??
      "Customer Name,Airtel Phone,Installed\nSynthetic A,254711890001,installed\n",
  );

  const sessionKey =
    opts?.sessionKey ?? "agent:bonface-owner:telegram:peer-1001";
  const fixture: TelegramIngressFixture = {
    message_id: 42,
    account: "bonface-telegram",
    peer: "1001",
    sender: "1001",
    document: { mime_type: "text/csv", file_name: fileName },
    downloadedPath,
    rootDir,
    sessionKey,
    fileRunId: "run-file-001",
    instructionRunId: "run-instruction-002",
    instructionMessageId: "43",
  };

  const pendingEvent = {
    mediaStagingPending: true,
    messageId: String(fixture.message_id),
    sessionKey: fixture.sessionKey,
    senderId: fixture.sender,
    accountId: fixture.account,
    peerId: fixture.peer,
  };

  const stagedEvent = {
    mediaStagingPending: false,
    messageId: String(fixture.message_id),
    sessionKey: fixture.sessionKey,
    senderId: fixture.sender,
    accountId: fixture.account,
    peerId: fixture.peer,
    media: [
      {
        path: fixture.downloadedPath,
        contentType: fixture.document.mime_type,
        kind: "document",
      },
    ],
  };

  const nextTextEvent = {
    mediaStagingPending: false,
    messageId: fixture.instructionMessageId,
    sessionKey: fixture.sessionKey,
    senderId: fixture.sender,
    accountId: fixture.account,
    peerId: fixture.peer,
    media: [],
  };

  const fileTurnCtx = {
    sessionKey: fixture.sessionKey,
    runId: fixture.fileRunId,
    peerId: fixture.peer,
    accountId: fixture.account,
    senderId: fixture.sender,
  };

  const instructionTurnCtx = {
    sessionKey: fixture.sessionKey,
    runId: fixture.instructionRunId,
    peerId: fixture.peer,
    messageId: fixture.instructionMessageId,
    accountId: fixture.account,
    senderId: fixture.sender,
  };

  const unpatchedInstructionTurnCtx = {
    sessionKey: fixture.sessionKey,
    runId: fixture.instructionRunId,
    peerId: fixture.peer,
    accountId: fixture.account,
    senderId: fixture.sender,
  };

  return {
    fixture,
    cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }),
    pendingEvent,
    stagedEvent,
    nextTextEvent,
    fileTurnCtx,
    instructionTurnCtx,
    unpatchedInstructionTurnCtx,
  };
}
