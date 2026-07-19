export type DispatchResultPayload = {
  outcome?: string;
  reason?: string;
  agentId?: string;
};

export function formatDispatchResultMessage(
  dispatch?: DispatchResultPayload,
): string {
  if (!dispatch?.outcome) return "Auto-dispatch finished.";

  if (dispatch.outcome === "offered") {
    return "Offer sent to next eligible agent.";
  }

  if (dispatch.outcome === "admin_queue") {
    if (
      dispatch.reason === "no_agents_in_county" ||
      dispatch.reason === "no_agents_or_fallback"
    ) {
      return "No eligible county or fallback agents left. Send offer manually.";
    }
    if (dispatch.reason === "unknown_county_or_town") {
      return "Town not mapped and no fallback agents. Send offer manually.";
    }
    return "No auto match. Send offer manually.";
  }

  if (dispatch.outcome === "skipped") {
    return `Skipped: ${dispatch.reason ?? "unknown"}.`;
  }

  return `Auto-dispatch: ${dispatch.outcome}.`;
}
