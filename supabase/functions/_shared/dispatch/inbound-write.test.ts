import { isUniqueViolation, planInboundWrite, type ExistingInboundLead } from "./inbound-write";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

type Row = ExistingInboundLead & { source: string; sourceExternalId: string | null; phone: string };
type Store = { rows: Row[]; notifications: string[] };

function insertRow(store: Store, row: Row): { row?: Row; error?: { code: string } } {
  const duplicate = store.rows.find(
    (existing) =>
      existing.source === row.source &&
      existing.sourceExternalId !== null &&
      existing.sourceExternalId === row.sourceExternalId,
  );
  if (duplicate) return { error: { code: "23505" } };
  store.rows.push(row);
  return { row };
}

function handle(store: Store, input: { source: string; externalId: string; phone: string; id: string }) {
  const existingByExternalId =
    store.rows.find((row) => row.source === input.source && row.sourceExternalId === input.externalId) ?? null;
  const existingByPhone =
    store.rows.find((row) => row.phone === input.phone) ?? null;
  const plan = planInboundWrite({
    externalId: input.externalId,
    existingByExternalId,
    existingByPhone,
  });
  if (plan.action !== "insert") {
    return { created: false, notified: false, leadId: plan.leadId, action: plan.action, duplicateOfLeadId: null };
  }
  const inserted = insertRow(store, {
    id: input.id,
    status: "pending_dispatch",
    source: input.source,
    sourceExternalId: input.externalId,
    phone: input.phone,
  });
  if (isUniqueViolation(inserted.error)) {
    const winner = store.rows.find(
      (row) => row.source === input.source && row.sourceExternalId === input.externalId,
    );
    return { created: false, notified: false, leadId: winner?.id ?? "", action: "replay" as const, duplicateOfLeadId: null };
  }
  store.notifications.push(input.id);
  return {
    created: true,
    notified: true,
    leadId: input.id,
    action: "insert" as const,
    duplicateOfLeadId: plan.duplicateOfLeadId,
  };
}

const fresh = planInboundWrite({ externalId: "sub-1", existingByExternalId: null, existingByPhone: null });
assert(fresh.action === "insert" && fresh.duplicateOfLeadId === null, "a new submission is inserted");

const replay = planInboundWrite({
  externalId: "sub-1",
  existingByExternalId: { id: "lead-1", status: "offered" },
  existingByPhone: { id: "lead-1", status: "offered" },
});
assert(replay.action === "replay" && replay.leadId === "lead-1", "the same submission id replays the original lead");

const phone = planInboundWrite({
  externalId: "sub-2",
  existingByExternalId: null,
  existingByPhone: { id: "lead-1", status: "assigned" },
});
assert(
  phone.action === "insert" && phone.duplicateOfLeadId === "lead-1",
  "a new submission id for an active phone is saved and flagged",
);

const later = planInboundWrite({
  externalId: "sub-3",
  existingByExternalId: null,
  existingByPhone: { id: "lead-1", status: "installed" },
});
assert(
  later.action === "insert" && later.duplicateOfLeadId === null,
  "a later order after a closed lead gets a new row",
);

assert(isUniqueViolation({ code: "23505" }), "unique violations are recognised");
assert(!isUniqueViolation({ code: "23502" }), "other database errors are not treated as retries");

const store: Store = { rows: [], notifications: [] };
const firstRead = planInboundWrite({ externalId: "same", existingByExternalId: null, existingByPhone: null });
const secondRead = planInboundWrite({ externalId: "same", existingByExternalId: null, existingByPhone: null });
assert(firstRead.action === "insert" && secondRead.action === "insert", "concurrent reads both attempt an insert");
const winner = insertRow(store, {
  id: "a",
  status: "pending_dispatch",
  source: "airtel5grouter",
  sourceExternalId: "same",
  phone: "254700000001",
});
const loser = insertRow(store, {
  id: "b",
  status: "pending_dispatch",
  source: "airtel5grouter",
  sourceExternalId: "same",
  phone: "254700000001",
});
if (winner.row) store.notifications.push(winner.row.id);
assert(isUniqueViolation(loser.error), "the second insert hits the unique constraint");
assert(store.notifications.length === 1 && store.rows.length === 1, "only the winning insert notifies an agent");
const replayed = handle(store, { source: "airtel5grouter", externalId: "same", phone: "254700000001", id: "c" });
assert(replayed.action === "replay" && replayed.notified === false && replayed.leadId === "a", "a retry returns the original lead without another notification");
const flagged = handle(store, { source: "airtel5grouter", externalId: "other", phone: "254700000001", id: "d" });
assert(
  flagged.action === "insert" && flagged.created && flagged.notified && flagged.duplicateOfLeadId === "a" && store.rows.length === 2,
  "a new submission for the same phone is stored, flagged, and dispatched once",
);

console.log("inbound write checks passed");
