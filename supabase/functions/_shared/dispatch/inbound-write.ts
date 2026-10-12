export const BLOCKING_LEAD_STATUSES = [
  "pending_dispatch",
  "offered",
  "assigned",
  "kyc_in_progress",
  "kyc_completed",
  "needs_reassignment",
  "admin_queue",
  "deferred",
] as const;

export type ExistingInboundLead = {
  id: string;
  status: string;
};

export type InboundWritePlan =
  | { action: "replay"; leadId: string; status: string }
  | { action: "insert"; duplicateOfLeadId: string | null };

export function planInboundWrite(input: {
  externalId: string | null;
  existingByExternalId: ExistingInboundLead | null;
  existingByPhone: ExistingInboundLead | null;
}): InboundWritePlan {
  if (input.externalId && input.existingByExternalId) {
    return {
      action: "replay",
      leadId: input.existingByExternalId.id,
      status: input.existingByExternalId.status,
    };
  }
  if (
    input.existingByPhone &&
    BLOCKING_LEAD_STATUSES.includes(
      input.existingByPhone.status as (typeof BLOCKING_LEAD_STATUSES)[number],
    )
  ) {
    return { action: "insert", duplicateOfLeadId: input.existingByPhone.id };
  }
  return { action: "insert", duplicateOfLeadId: null };
}

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
