import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AppConfig, ActorContext } from "./config.js";
import { OPENBOOK_ALLOWED_ROLES } from "./config.js";
import type { DbClient } from "./db.js";
import { checkRateLimit, rateLimitKey } from "./rateLimit.js";
import { hashParams, sanitizeErrorMessage, truncateJson } from "./redact.js";
import {
  AttachmentPathError,
  openAllowlistedAttachment,
} from "./attachment-path.js";
import {
  ATTACHMENT_BINDING_STATUS,
  lookupExplicitPriorReuse,
  rememberFingerprintReconcile,
} from "./attachment-binding.js";
import { DOC_LIMITS } from "./document-limits.js";
import { parseCsvDocument } from "./document-parse-csv.js";
import { inspectXlsxDocument, parseXlsxSheet } from "./document-parse-xlsx.js";
import type { ColumnMapping } from "./document-mapping.js";
import { sqlJsonb, sqlInt, sqlText } from "./sql-args.js";
import {
  DOCUMENTS_NAMESPACE,
  DOCUMENT_TOOL_NAMES,
  fullDocumentToolName,
  parseDocumentArgs,
  parseDocumentToolName,
  redactDocumentAuditArgs,
  type DocumentToolName,
} from "./validation-documents.js";

const PRODUCTION_GATEWAY_ROLES = ["technical_owner", "business_partner"] as const;

export type DocumentToolResult = {
  ok: boolean;
  denied?: boolean;
  /** Present only after successful audit persistence. */
  auditId: string | null;
  correlationId: string;
  data?: unknown;
  error?: { category: string; message: string };
};

function isReadAuthorized(cfg: AppConfig, actor: ActorContext): boolean {
  if (!OPENBOOK_ALLOWED_ROLES.includes(actor.actorRole as (typeof OPENBOOK_ALLOWED_ROLES)[number])) {
    return false;
  }
  if (cfg.identityMode === "production" && !actor.identityVerified) return false;
  if (
    cfg.identityMode === "production" &&
    !PRODUCTION_GATEWAY_ROLES.includes(actor.actorRole as (typeof PRODUCTION_GATEWAY_ROLES)[number])
  ) {
    return false;
  }
  return true;
}

function auditBase(
  correlationId: string,
  tool: DocumentToolName,
  actor: ActorContext,
  args: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    correlationId,
    operationName: fullDocumentToolName(tool),
    toolNamespace: DOCUMENTS_NAMESPACE,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    sessionOrChannelId: actor.sessionOrChannelId,
    paramHash: hashParams({ ...redactDocumentAuditArgs(tool, args), ...extra }),
    paramRedacted: { ...redactDocumentAuditArgs(tool, args), ...extra },
    instanceId: actor.instanceId,
    identityVerified: actor.identityVerified,
  };
}

async function persistAudit(
  db: DbClient,
  row: Parameters<DbClient["recordAudit"]>[0],
): Promise<string | null> {
  const w = await db.recordAudit(row);
  return w.ok ? w.id : null;
}

function detectFormat(basename: string, buffer: Buffer): "csv" | "xlsx" {
  const ext = path.extname(basename).toLowerCase();
  if (ext === ".csv") return "csv";
  if (ext === ".xlsx") {
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return "xlsx";
    throw Object.assign(new Error("XLSX signature mismatch"), { category: "malformed" });
  }
  throw Object.assign(new Error("Unsupported type"), { category: "unsupported_type" });
}

async function parseAttachment(
  buffer: Buffer,
  basename: string,
  opts: {
    sheet_index?: number;
    sheet_name?: string;
    mapping?: ColumnMapping;
    installed_only?: boolean;
  },
) {
  const format = detectFormat(basename, buffer);
  if (format === "csv") {
    return {
      format,
      parse: parseCsvDocument(buffer, {
        mapping: opts.mapping,
        installedOnly: opts.installed_only,
      }),
    };
  }
  return {
    format,
    parse: await parseXlsxSheet(buffer, {
      sheetIndex: opts.sheet_index,
      sheetName: opts.sheet_name,
      mapping: opts.mapping,
      installedOnly: opts.installed_only,
    }),
  };
}

function rowsForReconcile(rows: Array<Record<string, unknown>>) {
  return rows.map((r) => ({
    row_ref: r.row_ref,
    airtel_phone: r.airtel_phone,
    safaricom_phone: r.safaricom_phone,
    spreadsheet_installed: r.spreadsheet_installed,
  }));
}

export async function executeDocumentTool(opts: {
  tool: DocumentToolName;
  args: Record<string, unknown>;
  cfg: AppConfig;
  db: DbClient;
  actor: ActorContext;
}): Promise<DocumentToolResult> {
  const { tool, cfg, db, actor } = opts;
  const started = Date.now();
  const correlationId = randomUUID();
  let auditId: string | null = null;
  let parsed: Record<string, unknown> = {};

  const rl = checkRateLimit(
    rateLimitKey(actor.instanceId, actor.actorId),
    cfg.rateLimitPerMinute,
  );
  if (!rl.allowed) {
    return {
      ok: false,
      denied: true,
      auditId: null,
      correlationId,
      error: { category: "rate_limited", message: "Too many requests; try again shortly" },
    };
  }

  if (!isReadAuthorized(cfg, actor)) {
    return {
      ok: false,
      denied: true,
      auditId: null,
      correlationId,
      error: {
        category: "action_not_authorized",
        message: "Document tools are limited to verified technical_owner and business_partner",
      },
    };
  }

  if (!cfg.attachmentRoots?.trim()) {
    return {
      ok: false,
      auditId: null,
      correlationId,
      error: {
        category: "config",
        message: "WAM_AI_ATTACHMENT_ROOTS is not configured",
      },
    };
  }

  try {
    parsed = parseDocumentArgs(tool, opts.args);
  } catch {
    return {
      ok: false,
      denied: true,
      auditId: null,
      correlationId,
      error: { category: "validation", message: "Invalid document parameters" },
    };
  }

  // Explicit path required every call — never invent or auto-pick a previous path.
  if (!parsed.attachment_path || typeof parsed.attachment_path !== "string") {
    return {
      ok: false,
      auditId: null,
      correlationId,
      error: {
        category: "attachment_required",
        message:
          "No attachment_path supplied. Messages without an attachment must not process a prior file. " +
          ATTACHMENT_BINDING_STATUS.deployment_blocker,
      },
    };
  }

  try {
    const opened = openAllowlistedAttachment(
      String(parsed.attachment_path),
      cfg.attachmentRoots,
    );
    const safeMeta = {
      content_fingerprint: opened.contentFingerprint,
      basename: opened.basename,
      size_bytes: opened.size,
      root_index: opened.rootIndex,
      attachment_binding_note: ATTACHMENT_BINDING_STATUS.deployment_blocker,
    };

    if (tool === "inspect_business_document") {
      const format = detectFormat(opened.basename, opened.buffer);
      let data: Record<string, unknown>;
      if (format === "csv") {
        const p = parseCsvDocument(opened.buffer, {});
        data = {
          status: "success",
          operation: "inspect_business_document",
          format: "csv",
          ...safeMeta,
          sheet_names: ["csv"],
          sheets: [
            {
              sheetIndex: 0,
              sheetName: "csv",
              headers: p.headers,
              mappingResolution: p.mappingResolution,
              approximateDataRows: p.qualifyingRowCount,
            },
          ],
          flow_hint:
            "attachment_path → inspect → resolve mapping if needed → reconcile_document_customers → concise answer",
        };
      } else {
        const insp = await inspectXlsxDocument(opened.buffer);
        data = {
          status: "success",
          operation: "inspect_business_document",
          ...safeMeta,
          ...insp,
          flow_hint:
            "attachment_path → inspect → resolve mapping/sheet if needed → reconcile_document_customers → concise answer",
        };
      }
      auditId = await persistAudit(db, {
        ...auditBase(correlationId, tool, actor, parsed, safeMeta),
        dataClassification: "internal_operational",
        resultCount: 1,
        outcome: "success",
        errorCategory: null,
        durationMs: Date.now() - started,
      });
      const { payload, truncated } = truncateJson(data, cfg.maxResponseChars);
      if (truncated) {
        return {
          ok: false,
          auditId,
          correlationId,
          error: { category: "response_too_large", message: "Response exceeded size limit" },
        };
      }
      return { ok: true, auditId, correlationId, data: payload };
    }

    if (tool === "parse_document_customers") {
      const { format, parse } = await parseAttachment(opened.buffer, opened.basename, {
        sheet_index: parsed.sheet_index as number | undefined,
        sheet_name: parsed.sheet_name as string | undefined,
        mapping: parsed.mapping as ColumnMapping | undefined,
        installed_only: parsed.installed_only as boolean | undefined,
      });
      if (parse.mappingResolution.status !== "resolved") {
        const data = {
          status: "selection_required",
          operation: "parse_document_customers",
          format,
          ...safeMeta,
          mappingResolution: parse.mappingResolution,
          sheetName: parse.sheetName,
          sheetIndex: parse.sheetIndex,
          headers: parse.headers,
        };
        auditId = await persistAudit(db, {
          ...auditBase(correlationId, tool, actor, parsed, {
            ...safeMeta,
            selection: true,
          }),
          dataClassification: "internal_operational",
          resultCount: 0,
          outcome: "success",
          errorCategory: null,
          durationMs: Date.now() - started,
        });
        return { ok: true, auditId, correlationId, data };
      }
      const sample = parse.rows.slice(0, 5).map((r) => ({
        row_ref: r.row_ref,
        source_row_number: r.source_row_number,
        airtel_phone_masked: r.airtel_phone
          ? `${r.airtel_phone.slice(0, 4)}****${r.airtel_phone.slice(-3)}`
          : null,
        safaricom_phone_masked: r.safaricom_phone
          ? `${r.safaricom_phone.slice(0, 4)}****${r.safaricom_phone.slice(-3)}`
          : null,
      }));
      const data = {
        status: "success",
        operation: "parse_document_customers",
        format,
        ...safeMeta,
        sheetName: parse.sheetName,
        sheetIndex: parse.sheetIndex,
        qualifying_row_count: parse.qualifyingRowCount,
        truncated: parse.truncated,
        sample_rows_masked: sample,
        note: "Full rows are not returned; call reconcile_document_customers for Hub matching.",
      };
      auditId = await persistAudit(db, {
        ...auditBase(correlationId, tool, actor, parsed, {
          ...safeMeta,
          qualifying_row_count: parse.qualifyingRowCount,
        }),
        dataClassification: "internal_operational",
        resultCount: parse.qualifyingRowCount,
        outcome: "success",
        errorCategory: null,
        durationMs: Date.now() - started,
      });
      const { payload, truncated } = truncateJson(data, cfg.maxResponseChars);
      if (truncated) {
        return {
          ok: false,
          auditId,
          correlationId,
          error: { category: "response_too_large", message: "Response exceeded size limit" },
        };
      }
      return { ok: true, auditId, correlationId, data: payload };
    }

    // reconcile_document_customers
    const { format, parse } = await parseAttachment(opened.buffer, opened.basename, {
      sheet_index: parsed.sheet_index as number | undefined,
      sheet_name: parsed.sheet_name as string | undefined,
      mapping: parsed.mapping as ColumnMapping | undefined,
      installed_only: parsed.installed_only as boolean | undefined,
    });
    if (parse.mappingResolution.status !== "resolved") {
      return {
        ok: true,
        auditId: null,
        correlationId,
        data: {
          status: "selection_required",
          operation: "reconcile_document_customers",
          format,
          ...safeMeta,
          mappingResolution: parse.mappingResolution,
          sheetName: parse.sheetName,
          headers: parse.headers,
        },
      };
    }

    const reuseGate = {
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      sessionOrChannelId: actor.sessionOrChannelId,
      peerRef: (parsed.peer_ref as string | undefined) ?? null,
      contentFingerprint: opened.contentFingerprint,
      allowPriorFingerprintReuse: Boolean(parsed.allow_prior_fingerprint_reuse),
      sessionReset: Boolean(parsed.session_reset),
    };
    const prior = lookupExplicitPriorReuse(reuseGate);
    if (prior.hit) {
      auditId = await persistAudit(db, {
        ...auditBase(correlationId, tool, actor, parsed, {
          ...safeMeta,
          duplicate_content_short_circuit: true,
          prior_correlation_id: prior.correlationId,
        }),
        dataClassification: "personal_data_readonly",
        resultCount: Number(prior.summary.unique_input_customers ?? 0),
        outcome: "success",
        errorCategory: null,
        durationMs: Date.now() - started,
      });
      return {
        ok: true,
        auditId,
        correlationId,
        data: {
          ...prior.summary,
          status: "success",
          operation: "reconcile_document_customers",
          duplicate_content_short_circuit: true,
          document: safeMeta,
          note: "Explicit prior reuse: same fingerprint + actor/session/peer within TTL; Hub not queried again.",
        },
      };
    }

    const reconcileRows = rowsForReconcile(parse.rows as unknown as Array<Record<string, unknown>>);
    if (reconcileRows.length === 0) {
      return {
        ok: true,
        auditId: null,
        correlationId,
        data: {
          status: "success",
          operation: "reconcile_document_customers",
          ...safeMeta,
          unique_input_customers: 0,
          installed_unique_customers: 0,
          message: "No qualifying phone rows after parse",
        },
      };
    }
    if (reconcileRows.length > DOC_LIMITS.maxSessionRows) {
      return {
        ok: false,
        auditId: null,
        correlationId,
        error: { category: "limits", message: "Document exceeds maximum session rows" },
      };
    }

    let hubResult: Record<string, unknown>;
    if (reconcileRows.length <= DOC_LIMITS.maxReconcileChunk) {
      hubResult = (await db.callReportingFn("wam_ai", "reconcile_customer_batch", [
        sqlJsonb(reconcileRows),
      ])) as Record<string, unknown>;
    } else {
      const idem = (parsed.idempotency_key as string | undefined) ?? randomUUID();
      // begin: fingerprint text, idempotency text, actor text, role text, ttl int
      const begin = (await db.callReportingFn("wam_ai", "begin_reconcile_session", [
        sqlText(opened.contentFingerprint),
        sqlText(idem),
        sqlText(actor.actorId),
        sqlText(actor.actorRole),
        sqlInt(DOC_LIMITS.sessionTtlMinutes),
      ])) as Record<string, unknown>;
      if (begin.status !== "success") {
        return {
          ok: false,
          auditId: null,
          correlationId,
          error: {
            category: String(begin.error_category ?? "failure"),
            message: String(begin.message ?? "begin session failed"),
          },
        };
      }
      const token = String(begin.session_token);
      for (let i = 0; i < reconcileRows.length; i += DOC_LIMITS.maxReconcileChunk) {
        const chunk = reconcileRows.slice(i, i + DOC_LIMITS.maxReconcileChunk);
        // append: session_token text, rows jsonb, actor text, role text
        const ap = (await db.callReportingFn("wam_ai", "append_reconcile_session_rows", [
          sqlText(token),
          sqlJsonb(chunk),
          sqlText(actor.actorId),
          sqlText(actor.actorRole),
        ])) as Record<string, unknown>;
        if (ap.status !== "success") {
          return {
            ok: false,
            auditId: null,
            correlationId,
            error: {
              category: String(ap.error_category ?? "failure"),
              message: String(ap.message ?? "append failed"),
            },
          };
        }
      }
      hubResult = (await db.callReportingFn("wam_ai", "finalize_reconcile_session", [
        sqlText(token),
        sqlText(actor.actorId),
        sqlText(actor.actorRole),
      ])) as Record<string, unknown>;
    }

    const summary = {
      unique_input_customers: hubResult.unique_input_customers ?? 0,
      exact_unique_customers: hubResult.exact_unique_customers ?? 0,
      installed_unique_customers: hubResult.installed_unique_customers ?? 0,
      unmatched_groups: hubResult.unmatched_groups ?? 0,
      duplicate_spreadsheet_rows: hubResult.duplicate_spreadsheet_rows ?? 0,
      qualifying_spreadsheet_rows: hubResult.qualifying_spreadsheet_rows ?? 0,
    };
    rememberFingerprintReconcile(
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        sessionOrChannelId: actor.sessionOrChannelId,
        peerRef: (parsed.peer_ref as string | undefined) ?? null,
        contentFingerprint: opened.contentFingerprint,
      },
      correlationId,
      summary,
    );

    const mode = (parsed.response_mode as string) || "full";
    let data: Record<string, unknown>;
    if (mode === "number_only") {
      data = {
        status: hubResult.status ?? "success",
        installed_unique_customers: hubResult.installed_unique_customers ?? 0,
        unique_input_customers: hubResult.unique_input_customers ?? 0,
        exact_unique_customers: hubResult.exact_unique_customers ?? 0,
      };
    } else {
      data = {
        ...hubResult,
        operation: "reconcile_document_customers",
        document: safeMeta,
        format,
        sheetName: parse.sheetName,
        parse_qualifying_rows: parse.qualifyingRowCount,
        user_guidance:
          "Prefer unique_input_customers / installed_unique_customers for answers. Do not expose tool chatter to Telegram.",
      };
    }

    auditId = await persistAudit(db, {
      ...auditBase(correlationId, tool, actor, parsed, {
        ...safeMeta,
        qualifying_row_count: parse.qualifyingRowCount,
        unique_input_customers: hubResult.unique_input_customers ?? null,
        installed_unique_customers: hubResult.installed_unique_customers ?? null,
      }),
      dataClassification: "personal_data_readonly",
      resultCount: Number(hubResult.unique_input_customers ?? 0),
      outcome: hubResult.status === "success" ? "success" : "failure",
      errorCategory:
        hubResult.status === "success" ? null : String(hubResult.error_category ?? "failure"),
      durationMs: Date.now() - started,
    });

    const { payload, truncated } = truncateJson(data, cfg.maxResponseChars);
    if (truncated) {
      return {
        ok: false,
        auditId,
        correlationId,
        error: { category: "response_too_large", message: "Response exceeded size limit" },
      };
    }

    return {
      ok: hubResult.status === "success" || hubResult.status === undefined,
      auditId,
      correlationId,
      data: payload,
    };
  } catch (err) {
    const category =
      err instanceof AttachmentPathError
        ? err.category
        : typeof err === "object" && err && "category" in err
          ? String((err as { category: string }).category)
          : "failure";
    const message =
      err instanceof Error ? err.message : sanitizeErrorMessage(err).message;
    try {
      auditId = await persistAudit(db, {
        ...auditBase(correlationId, tool, actor, parsed),
        dataClassification: "internal_operational",
        resultCount: 0,
        outcome: "failure",
        errorCategory: category,
        durationMs: Date.now() - started,
      });
    } catch {
      auditId = null;
    }
    return { ok: false, auditId, correlationId, error: { category, message } };
  }
}

const DESCRIPTIONS: Record<DocumentToolName, string> = {
  inspect_business_document:
    "Safely inspect an allowlisted Telegram/OpenClaw inbound CSV/XLSX attachment: sheets, headers, mapping candidates. Requires explicit attachment_path every call (no stale path reuse). Never reads paths outside WAM_AI_ATTACHMENT_ROOTS.",
  parse_document_customers:
    "Parse allowlisted attachment into customer phone rows (diagnostics only; phones masked). Returns selection metadata for ask_user when mapping/sheet is ambiguous. Does not call Agent Hub.",
  reconcile_document_customers:
    "Parse allowlisted attachment then reconcile against Agent Hub via reconcile_customer_batch (or a bounded session for >250 rows). Requires explicit attachment_path; fingerprint short-circuit only when allow_prior_fingerprint_reuse=true with matching identity/session/peer. response_mode=number_only for concise answers.",
};

export function listDocumentTools(): Array<{ name: string; description: string }> {
  return DOCUMENT_TOOL_NAMES.map((tool) => ({
    name: fullDocumentToolName(tool),
    description: DESCRIPTIONS[tool],
  }));
}

export {
  parseDocumentToolName,
  fullDocumentToolName,
  DOCUMENT_TOOL_NAMES,
  DOCUMENTS_NAMESPACE,
};
