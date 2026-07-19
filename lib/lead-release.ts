/** Labels for inbound lead release / KYC outcome. */

export function formatKycOutcomeLabel(outcome: string | null | undefined): string {
  switch (outcome) {
    case "completed":
      return "KYC completed";
    case "unreachable":
      return "Customer unreachable";
    case "declined":
      return "Customer declined";
    case "kyc_failed":
      return "KYC / registration failed";
    default:
      return outcome ? outcome.replace(/_/g, " ") : "—";
  }
}

export type LeadReleaseInfo = {
  reason: string | null;
  reasonLabel: string;
  notes: string | null;
  agentName: string | null;
  agentId: string | null;
  at: string | null;
};

export function getLeadReleaseInfo(lead: {
  kyc_outcome?: string | null;
  metadata?: Record<string, unknown> | null;
}): LeadReleaseInfo {
  const meta = lead.metadata ?? {};
  const last =
    meta.lastRelease && typeof meta.lastRelease === "object"
      ? (meta.lastRelease as Record<string, unknown>)
      : null;

  const reason =
    (typeof last?.reason === "string" ? last.reason : null) ||
    lead.kyc_outcome ||
    null;

  return {
    reason,
    reasonLabel: formatKycOutcomeLabel(reason),
    notes: typeof last?.notes === "string" ? last.notes : null,
    agentName: typeof last?.agentName === "string" ? last.agentName : null,
    agentId: typeof last?.agentId === "string" ? last.agentId : null,
    at: typeof last?.at === "string" ? last.at : null,
  };
}
