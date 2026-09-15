/**
 * Phase 1A.9 business query catalogue (TypeScript mirror).
 * SQL SECURITY DEFINER RPCs enforce the same allowlists — never trust caller SQL.
 */

export const QUERY_NAMESPACE = "wam.business.query";
export const QUERY_CATALOGUE_VERSION = "1a9.1";
export const BUSINESS_TZ = "Africa/Nairobi";

export const QUERY_DATASETS = [
  "agents",
  "customer_registrations",
  "inbound_leads",
  "safaricom_registrations",
] as const;

export type QueryDataset = (typeof QUERY_DATASETS)[number];

export const RESPONSE_MODES = ["number_only", "summary", "detailed"] as const;
export type QueryResponseMode = (typeof RESPONSE_MODES)[number];

export const AGGREGATE_FNS = ["count", "count_distinct", "min", "max"] as const;

export const FILTER_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "is_null",
  "is_not_null",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "ilike_prefix",
  "eq_calendar_date",
  "date_trunc_eq",
  "relative_range",
] as const;

export type FieldDef = {
  id: string;
  sqlColumn: string;
  type: "uuid" | "text" | "timestamptz" | "date" | "date_text_mdy" | "boolean" | "number";
  filterable: boolean;
  selectable: boolean;
  groupable: boolean;
  sortable: boolean;
  aggregateTarget: boolean;
  exposure: "owner_open_book";
  aliases?: string[];
};

export type DatasetDef = {
  id: QueryDataset;
  table: string;
  alias: string;
  primaryKey: string;
  businessRef: "agent_business_id" | "lead_ref" | "registration_ref";
  defaultSort: { field: string; dir: "asc" | "desc" }[];
  fields: FieldDef[];
  statusValues?: string[];
};

const agentFields: FieldDef[] = [
  { id: "created_at", sqlColumn: "created_at", type: "timestamptz", filterable: true, selectable: true, groupable: false, sortable: true, aggregateTarget: true, exposure: "owner_open_book", aliases: ["joined", "joined_at", "registration_date", "account_created_at"] },
  { id: "status", sqlColumn: "status", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "name", sqlColumn: "name", type: "text", filterable: true, selectable: true, groupable: false, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "email", sqlColumn: "email", type: "text", filterable: true, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "airtel_phone", sqlColumn: "airtel_phone", type: "text", filterable: true, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "safaricom_phone", sqlColumn: "safaricom_phone", type: "text", filterable: true, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "town", sqlColumn: "town", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["location", "location_town"] },
  { id: "area", sqlColumn: "area", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "id", sqlColumn: "id", type: "uuid", filterable: false, selectable: false, groupable: false, sortable: false, aggregateTarget: true, exposure: "owner_open_book" },
];

const crFields: FieldDef[] = [
  { id: "created_at", sqlColumn: "created_at", type: "timestamptz", filterable: true, selectable: true, groupable: false, sortable: true, aggregateTarget: true, exposure: "owner_open_book" },
  { id: "visit_date", sqlColumn: "visit_date", type: "date_text_mdy", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["visit_day", "scheduled_visit", "appointment_date"] },
  { id: "visit_time", sqlColumn: "visit_time", type: "text", filterable: false, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "status", sqlColumn: "status", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "customer_name", sqlColumn: "customer_name", type: "text", filterable: true, selectable: true, groupable: false, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "airtel_number", sqlColumn: "airtel_number", type: "text", filterable: true, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book", aliases: ["phone", "primary_phone"] },
  { id: "alternate_number", sqlColumn: "alternate_number", type: "text", filterable: true, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "preferred_package", sqlColumn: "preferred_package", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["package"] },
  { id: "installation_town", sqlColumn: "installation_town", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["town", "location"] },
  { id: "id", sqlColumn: "id", type: "uuid", filterable: false, selectable: false, groupable: false, sortable: false, aggregateTarget: true, exposure: "owner_open_book" },
];

const leadFields: FieldDef[] = [
  { id: "created_at", sqlColumn: "created_at", type: "timestamptz", filterable: true, selectable: true, groupable: false, sortable: true, aggregateTarget: true, exposure: "owner_open_book" },
  { id: "visit_date", sqlColumn: "visit_date", type: "date", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["visit_day", "scheduled_visit", "appointment_date"] },
  { id: "visit_time", sqlColumn: "visit_time", type: "text", filterable: false, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "installed_at", sqlColumn: "installed_at", type: "timestamptz", filterable: true, selectable: true, groupable: false, sortable: true, aggregateTarget: true, exposure: "owner_open_book" },
  { id: "status", sqlColumn: "status", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "customer_name", sqlColumn: "customer_name", type: "text", filterable: true, selectable: true, groupable: false, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "primary_phone", sqlColumn: "primary_phone", type: "text", filterable: true, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book", aliases: ["phone"] },
  { id: "alternate_phone", sqlColumn: "alternate_phone", type: "text", filterable: true, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "county", sqlColumn: "county", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "installation_town", sqlColumn: "installation_town", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["town", "location"] },
  { id: "product", sqlColumn: "product", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "preferred_package", sqlColumn: "preferred_package", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["package"] },
  { id: "id", sqlColumn: "id", type: "uuid", filterable: false, selectable: false, groupable: false, sortable: false, aggregateTarget: true, exposure: "owner_open_book" },
];

const safFields: FieldDef[] = [
  { id: "created_at", sqlColumn: "created_at", type: "timestamptz", filterable: true, selectable: true, groupable: false, sortable: true, aggregateTarget: true, exposure: "owner_open_book" },
  { id: "status", sqlColumn: "status", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "customer_name", sqlColumn: "customer_name", type: "text", filterable: true, selectable: true, groupable: false, sortable: true, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "safaricom_number", sqlColumn: "safaricom_number", type: "text", filterable: true, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book", aliases: ["phone", "primary_phone"] },
  { id: "alternate_number", sqlColumn: "alternate_number", type: "text", filterable: true, selectable: true, groupable: false, sortable: false, aggregateTarget: false, exposure: "owner_open_book" },
  { id: "service_package", sqlColumn: "service_package", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["package"] },
  { id: "install_county", sqlColumn: "install_county", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["county"] },
  { id: "install_town", sqlColumn: "install_town", type: "text", filterable: true, selectable: true, groupable: true, sortable: true, aggregateTarget: false, exposure: "owner_open_book", aliases: ["town", "location"] },
  { id: "id", sqlColumn: "id", type: "uuid", filterable: false, selectable: false, groupable: false, sortable: false, aggregateTarget: true, exposure: "owner_open_book" },
];

export const DATASET_DEFS: Record<QueryDataset, DatasetDef> = {
  agents: {
    id: "agents",
    table: "public.agents",
    alias: "a",
    primaryKey: "id",
    businessRef: "agent_business_id",
    defaultSort: [{ field: "created_at", dir: "desc" }],
    fields: agentFields,
    statusValues: ["pending", "approved", "rejected", "banned"],
  },
  customer_registrations: {
    id: "customer_registrations",
    table: "public.customer_registrations",
    alias: "cr",
    primaryKey: "id",
    businessRef: "registration_ref",
    defaultSort: [{ field: "created_at", dir: "desc" }],
    fields: crFields,
    statusValues: ["pending", "installed", "rejected", "duplicate", "cancelled"],
  },
  inbound_leads: {
    id: "inbound_leads",
    table: "public.inbound_leads",
    alias: "l",
    primaryKey: "id",
    businessRef: "lead_ref",
    defaultSort: [{ field: "created_at", dir: "desc" }],
    fields: leadFields,
    statusValues: [
      "pending_dispatch",
      "offered",
      "assigned",
      "kyc_in_progress",
      "kyc_completed",
      "pending_install",
      "installed",
      "rejected",
      "duplicate",
      "cancelled",
      "needs_reassignment",
      "admin_queue",
      "lost",
      "expired",
      "deferred",
    ],
  },
  safaricom_registrations: {
    id: "safaricom_registrations",
    table: "public.safaricom_registrations",
    alias: "sr",
    primaryKey: "id",
    businessRef: "registration_ref",
    defaultSort: [{ field: "created_at", dir: "desc" }],
    fields: safFields,
    statusValues: ["pending", "installed", "rejected", "duplicate", "cancelled"],
  },
};

export const SEMANTIC_ALIASES: Record<string, { dataset?: QueryDataset; field: string; note: string }> = {
  joined: { dataset: "agents", field: "created_at", note: "agents.created_at only; not approval" },
  joined_at: { dataset: "agents", field: "created_at", note: "agents.created_at only; not approval" },
  registration_date: { dataset: "agents", field: "created_at", note: "For agents: created_at. Not visit_date." },
  visit_day: { field: "visit_date", note: "Maps to visit_date; never created_at" },
  visit_date: { field: "visit_date", note: "Scheduled visit date" },
  scheduled_visit: { field: "visit_date", note: "Maps to visit_date" },
  appointment_date: { field: "visit_date", note: "Maps to visit_date" },
};

export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_GROUP_BY = 3;
export const MAX_FILTERS = 12;
export const MAX_METRICS = 5;
export const MAX_SORT = 2;
export const MAX_RANGE_DAYS = 90;

export function getDataset(id: string): DatasetDef | null {
  if ((QUERY_DATASETS as readonly string[]).includes(id)) {
    return DATASET_DEFS[id as QueryDataset];
  }
  return null;
}

export function resolveField(dataset: DatasetDef, fieldId: string): FieldDef | null {
  const direct = dataset.fields.find((f) => f.id === fieldId);
  if (direct) return direct;
  for (const f of dataset.fields) {
    if (f.aliases?.includes(fieldId)) return f;
  }
  return null;
}

export function buildCataloguePayload(datasetFilter?: string | null): Record<string, unknown> {
  const datasets = QUERY_DATASETS.filter((d) => !datasetFilter || d === datasetFilter).map((id) => {
    const def = DATASET_DEFS[id];
    return {
      id: def.id,
      fields: def.fields
        .filter((f) => f.selectable || f.filterable || f.groupable || f.aggregateTarget)
        .map((f) => ({
          id: f.id,
          type: f.type,
          filterable: f.filterable,
          selectable: f.selectable,
          groupable: f.groupable,
          sortable: f.sortable,
          aggregate_target: f.aggregateTarget,
          aliases: f.aliases ?? [],
        })),
      status_values: def.statusValues ?? [],
      default_sort: def.defaultSort,
      notes:
        id === "customer_registrations"
          ? ["visit_date is TEXT M/d/yyyy or ISO YYYY-MM-DD; parsed fail-closed; never substitute created_at"]
          : id === "agents"
            ? ["joined means created_at; approved_at does not exist"]
            : id === "safaricom_registrations"
              ? ["no visit_date field"]
              : ["visit_date is native DATE"],
    };
  });

  return {
    catalogue_version: QUERY_CATALOGUE_VERSION,
    timezone: BUSINESS_TZ,
    response_modes: RESPONSE_MODES,
    operators: FILTER_OPS,
    aggregates: AGGREGATE_FNS,
    limits: {
      max_list_limit: MAX_LIST_LIMIT,
      default_list_limit: DEFAULT_LIST_LIMIT,
      max_range_days: MAX_RANGE_DAYS,
      max_filters: MAX_FILTERS,
      max_group_by: MAX_GROUP_BY,
    },
    semantic_aliases: SEMANTIC_ALIASES,
    datasets,
    clarification_intents: [
      {
        intent: "customers_visit_today",
        reason: "visit_date exists on customer_registrations and inbound_leads",
        candidate_datasets: ["customer_registrations", "inbound_leads"],
      },
      {
        intent: "installations_by_county_period",
        reason: "installation may mean inbound_leads.installed_at/status or registration status=installed",
        candidate_datasets: ["inbound_leads", "customer_registrations", "safaricom_registrations"],
        candidate_date_fields: ["installed_at", "created_at", "status"],
      },
    ],
    model_guidance: {
      flow: "natural_language → catalogue when needed → structured JSON → validated read-only query → concise answer",
      never_guess_dataset: true,
      never_substitute_created_at_for_visit_date: true,
      mcp_accepts_structured_json_only: true,
    },
  };
}

/** Return clarification when the structured request is under-specified for known ambiguous intents. */
export function detectClarification(
  tool: "list_business_records" | "aggregate_business_metrics" | "describe_business_query_catalogue",
  args: Record<string, unknown>,
): Record<string, unknown> | null {
  const intent = typeof args.intent === "string" ? args.intent.trim() : "";
  const dataset = typeof args.dataset === "string" ? args.dataset.trim() : "";

  if (tool === "describe_business_query_catalogue" && intent === "customers_visit_today") {
    return {
      status: "clarification_required",
      clarification: {
        question:
          "Which records should I use for visits today: Airtel customer registrations, inbound leads, or both as separate queries?",
        ask_user: true,
        candidates: [
          { dataset: "customer_registrations", field: "visit_date" },
          { dataset: "inbound_leads", field: "visit_date" },
        ],
      },
    };
  }

  if (tool === "describe_business_query_catalogue" && intent === "installations_by_county_period") {
    return {
      status: "clarification_required",
      clarification: {
        question:
          "For installations, should I count inbound leads (installed_at / status=installed), Airtel registrations (status=installed), or Safaricom registrations (status=installed)? Which date field: installed_at (leads only) or created_at?",
        ask_user: true,
        candidates: [
          { dataset: "inbound_leads", date_field: "installed_at", status: "installed" },
          { dataset: "inbound_leads", date_field: "created_at", status: "installed" },
          { dataset: "customer_registrations", date_field: "created_at", status: "installed" },
          { dataset: "safaricom_registrations", date_field: "created_at", status: "installed" },
        ],
      },
    };
  }

  if (
    (tool === "list_business_records" || tool === "aggregate_business_metrics") &&
    intent === "customers_visit_today" &&
    !dataset
  ) {
    return detectClarification("describe_business_query_catalogue", { intent });
  }

  if (
    (tool === "list_business_records" || tool === "aggregate_business_metrics") &&
    intent === "installations_by_county_period"
  ) {
    return detectClarification("describe_business_query_catalogue", { intent });
  }

  if (
    (tool === "list_business_records" || tool === "aggregate_business_metrics") &&
    !dataset
  ) {
    return {
      status: "clarification_required",
      clarification: {
        question: "Which dataset should I query?",
        ask_user: true,
        candidates: QUERY_DATASETS.map((d) => ({ dataset: d })),
      },
    };
  }

  return null;
}
