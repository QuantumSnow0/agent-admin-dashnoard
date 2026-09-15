import { describe, expect, it } from "vitest";
import {
  BUSINESS_TZ,
  DATASET_DEFS,
  QUERY_DATASETS,
  SEMANTIC_ALIASES,
  buildCataloguePayload,
  detectClarification,
  resolveField,
} from "../src/query-catalogue.js";
import { nairobiYmd, parseMdyVisitDate, parseVisitDateText, relativeRange } from "../src/query-dates.js";
import {
  QUERY_NAMESPACE,
  QUERY_TOOL_NAMES,
  QUERY_TOOL_SCHEMAS,
  jsonSchemaAllowsOnlyDeclaredKeys,
  parseQueryArgs,
  parseQueryToolName,
  redactQueryAuditArgs,
  tryClarification,
  zodQueryPropertyKeys,
  jsonSchemaPropertyKeys,
} from "../src/validation-query.js";
import { argsContainForbiddenSql, parseAnyToolName } from "../src/server.js";
import { ValidationError } from "../src/validation.js";

describe("Phase 1A.9 catalogue & aliases", () => {
  it("covers required datasets", () => {
    expect(QUERY_DATASETS).toEqual([
      "agents",
      "customer_registrations",
      "inbound_leads",
      "safaricom_registrations",
    ]);
  });

  it("maps joined / visit_day aliases", () => {
    expect(SEMANTIC_ALIASES.joined.field).toBe("created_at");
    expect(SEMANTIC_ALIASES.joined.dataset).toBe("agents");
    expect(SEMANTIC_ALIASES.visit_day.field).toBe("visit_date");
    const cr = DATASET_DEFS.customer_registrations;
    expect(resolveField(cr, "visit_day")?.id).toBe("visit_date");
    expect(resolveField(cr, "visit_date")?.type).toBe("date_text_mdy");
    const agents = DATASET_DEFS.agents;
    expect(resolveField(agents, "joined")?.id).toBe("created_at");
  });

  it("catalogue documents Nairobi timezone and no SQL guidance", () => {
    const cat = buildCataloguePayload();
    expect(cat.timezone).toBe(BUSINESS_TZ);
    expect((cat.model_guidance as { mcp_accepts_structured_json_only: boolean }).mcp_accepts_structured_json_only).toBe(
      true,
    );
  });
});

describe("Phase 1A.9 clarification (never guess)", () => {
  it("customers scheduled visit today → clarification without dataset", () => {
    const c = detectClarification("list_business_records", {
      intent: "customers_visit_today",
    });
    expect(c?.status).toBe("clarification_required");
    expect((c?.clarification as { ask_user: boolean }).ask_user).toBe(true);
    const candidates = (c?.clarification as { candidates: unknown[] }).candidates;
    expect(candidates).toHaveLength(2);
  });

  it("Nairobi installations last week → clarification", () => {
    const c = tryClarification("aggregate_business_metrics", {
      intent: "installations_by_county_period",
      metrics: [{ fn: "count", field: "id" }],
    });
    expect(c?.status).toBe("clarification_required");
  });

  it("does not guess dataset when omitted", () => {
    const c = detectClarification("list_business_records", {});
    expect(c?.status).toBe("clarification_required");
  });
});

describe("Phase 1A.9 date helpers", () => {
  it("parses M/d/yyyy and zero-padded MDY fail-closed", () => {
    expect(parseVisitDateText("9/10/2026")).toBe("2026-09-10");
    expect(parseVisitDateText("09/10/2026")).toBe("2026-09-10");
    expect(parseMdyVisitDate("1/2/2026")).toBe("2026-01-02");
    expect(parseVisitDateText("02/29/2024")).toBe("2024-02-29");
    expect(parseVisitDateText("02/29/2025")).toBeNull();
    expect(parseVisitDateText("2/30/2026")).toBeNull();
    expect(parseVisitDateText("13/1/2026")).toBeNull();
    expect(parseVisitDateText("")).toBeNull();
  });

  it("parses ISO YYYY-MM-DD fail-closed with strict widths", () => {
    expect(parseVisitDateText("2026-09-10")).toBe("2026-09-10");
    expect(parseVisitDateText("2024-02-29")).toBe("2024-02-29");
    expect(parseVisitDateText("2025-02-29")).toBeNull();
    expect(parseVisitDateText("2026-02-30")).toBeNull();
    expect(parseVisitDateText("2026-9-10")).toBeNull();
    expect(parseVisitDateText("2026/09/10")).toBeNull();
    expect(parseVisitDateText("26-09-10")).toBeNull();
  });

  it("trims leading/trailing whitespace; rejects internal whitespace", () => {
    expect(parseVisitDateText("  2026-09-10  ")).toBe("2026-09-10");
    expect(parseVisitDateText("  9/10/2026 ")).toBe("2026-09-10");
    expect(parseVisitDateText("2026-09- 10")).toBeNull();
    expect(parseVisitDateText("9 /10/2026")).toBeNull();
  });

  it("rejects SQL-injection-shaped date strings", () => {
    expect(parseVisitDateText("2026-09-10'; DROP TABLE agents;--")).toBeNull();
    expect(parseVisitDateText("9/10/2026' OR 1=1 --")).toBeNull();
  });

  it("mixed-format production-shaped ISO cohort all parse", () => {
    const isoOnly = ["2026-09-08", "2026-09-09", "2026-09-10"];
    expect(isoOnly.map(parseVisitDateText)).toEqual(isoOnly);
    expect(parseVisitDateText("9/8/2026")).toBe("2026-09-08");
  });

  it("Africa/Nairobi this_month half-open boundaries", () => {
    // 2026-09-15 22:00 UTC = 2026-09-16 01:00 Nairobi
    const now = new Date("2026-09-15T22:00:00.000Z");
    expect(nairobiYmd(now)).toBe("2026-09-16");
    const r = relativeRange("this_month", now);
    expect(r.start_date).toBe("2026-09-01");
    expect(r.end_date).toBe("2026-10-01");
    expect(r.start).toBe(new Date("2026-09-01T00:00:00+03:00").toISOString());
    expect(r.end).toBe(new Date("2026-10-01T00:00:00+03:00").toISOString());
  });

  it("today / yesterday / this_week / last_week / last_month half-open", () => {
    const now = new Date("2026-09-10T10:00:00+03:00"); // Thursday
    const t = relativeRange("today", now);
    expect(t.start_date).toBe("2026-09-10");
    expect(t.end_date).toBe("2026-09-11");
    const y = relativeRange("yesterday", now);
    expect(y.start_date).toBe("2026-09-09");
    expect(y.end_date).toBe("2026-09-10");
    const tw = relativeRange("this_week", now);
    expect(tw.start_date).toBe("2026-09-07");
    expect(tw.end_date).toBe("2026-09-14");
    const lw = relativeRange("last_week", now);
    expect(lw.start_date).toBe("2026-08-31"); // Monday of prior ISO week
    expect(lw.end_date).toBe("2026-09-07");
    const lm = relativeRange("last_month", now);
    expect(lm.start_date).toBe("2026-08-01");
    expect(lm.end_date).toBe("2026-09-01");
  });

  it("next_week is not a supported relative period (deferred)", () => {
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "customer_registrations",
        filters: [{ field: "visit_date", op: "relative_range", value: "next_week" as never }],
      }),
    ).toThrow(ValidationError);
  });
});

describe("Phase 1A.9 structured validation", () => {
  it("accepts agents joined this month number_only", () => {
    const parsed = parseQueryArgs("aggregate_business_metrics", {
      dataset: "agents",
      metrics: [{ fn: "count", field: "id", alias: "agents_joined" }],
      filters: [{ field: "created_at", op: "relative_range", value: "this_month" }],
      response_mode: "number_only",
    });
    expect(parsed.dataset).toBe("agents");
    expect(parsed.response_mode).toBe("number_only");
  });

  it("maps visit_day filter to visit_date canonical field", () => {
    const parsed = parseQueryArgs("list_business_records", {
      dataset: "customer_registrations",
      filters: [{ field: "visit_day", op: "relative_range", value: "today" }],
      response_mode: "summary",
    });
    const filters = parsed.filters as Array<{ field: string }>;
    expect(filters[0].field).toBe("visit_date");
  });

  it("rejects invalid dataset / field / op / aggregate / sort", () => {
    expect(() =>
      parseQueryArgs("list_business_records", { dataset: "payments" as never }),
    ).toThrow(ValidationError);
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        filters: [{ field: "balance", op: "eq", value: "1" }],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        filters: [{ field: "status", op: "like" as never, value: "%" }],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      parseQueryArgs("aggregate_business_metrics", {
        dataset: "agents",
        metrics: [{ fn: "sum" as never, field: "id" }],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        sort: [{ field: "email", dir: "asc" }],
      }),
    ).toThrow(ValidationError); // email not sortable
  });

  it("rejects SQL / catalogue probing keys and injection-shaped fields", () => {
    expect(argsContainForbiddenSql({ sql: "select 1" })).toBe(true);
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        sql: "select 1",
      } as never),
    ).toThrow(ValidationError);
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        filters: [{ field: "created_at;drop", op: "eq", value: "x" }],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        sort: [{ field: "created_at desc;--" }],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      parseQueryArgs("aggregate_business_metrics", {
        dataset: "agents",
        metrics: [{ fn: "count", field: "id" }],
        group_by: ["status); select 1"],
      }),
    ).toThrow(ValidationError);
    expect(
      jsonSchemaAllowsOnlyDeclaredKeys("list_business_records", {
        dataset: "agents",
        sql: "x",
      }),
    ).toBe(false);
  });

  it("rejects joins and excessive complexity", () => {
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        joins: ["x"] as never,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        limit: 500,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        filters: Array.from({ length: 13 }, () => ({
          field: "status",
          op: "eq",
          value: "pending",
        })),
      }),
    ).toThrow(ValidationError);
  });

  it("rejects relative_range on non-date fields", () => {
    expect(() =>
      parseQueryArgs("list_business_records", {
        dataset: "agents",
        filters: [{ field: "status", op: "relative_range", value: "today" }],
      }),
    ).toThrow(ValidationError);
  });

  it("audit redaction stores shape only — no filter values / phones / names", () => {
    const redacted = redactQueryAuditArgs("list_business_records", {
      dataset: "customer_registrations",
      filters: [
        { field: "visit_date", op: "relative_range", value: "today" },
        { field: "customer_name", op: "eq", value: "Jane Doe" },
        { field: "airtel_number", op: "eq", value: "254712345678" },
      ],
      select: ["customer_name", "airtel_number"],
      limit: 10,
    });
    const blob = JSON.stringify(redacted);
    expect(blob).not.toContain("Jane Doe");
    expect(blob).not.toContain("254712345678");
    expect(blob).not.toContain("today");
    expect(redacted.filter_count).toBe(3);
    expect(redacted.dataset).toBe("customer_registrations");
  });
});

describe("Phase 1A.9 MCP wiring", () => {
  it("registers wam.business.query namespace tools only (no mutations)", () => {
    expect(QUERY_NAMESPACE).toBe("wam.business.query");
    expect(QUERY_TOOL_NAMES).toEqual([
      "describe_business_query_catalogue",
      "list_business_records",
      "aggregate_business_metrics",
    ]);
    for (const t of QUERY_TOOL_NAMES) {
      expect(parseQueryToolName(`${QUERY_NAMESPACE}.${t}`)).toBe(t);
      expect(parseAnyToolName(`${QUERY_NAMESPACE}.${t}`)?.kind).toBe("query");
      expect(QUERY_TOOL_SCHEMAS[t].additionalProperties).toBe(false);
      expect(zodQueryPropertyKeys(t)).toEqual(jsonSchemaPropertyKeys(t));
    }
    expect(parseAnyToolName("wam.business.query.delete_records")).toBeNull();
    expect(parseAnyToolName("wam.business.query.send_sms")).toBeNull();
  });
});
