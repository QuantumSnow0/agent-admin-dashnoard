/**
 * Notify an agent that inbound lead dispatch was enabled for them.
 * Inserts a SYSTEM_ANNOUNCEMENT and delivers Expo push (does not rely on webhook).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverPushNotification } from "@/lib/dispatch/push-delivery";

const SCOPE_LABEL: Record<string, string> = {
  airtel: "Airtel",
  safaricom: "Safaricom",
  both: "Airtel & Safaricom",
};

export async function notifyAgentLeadsDispatchEnabled(
  service: SupabaseClient,
  agentId: string,
  scope: string,
): Promise<void> {
  if (scope === "none") return;

  const productLabel = SCOPE_LABEL[scope] ?? "inbound";
  const title = "You're cleared for inbound leads";
  const message = `Admin enabled ${productLabel} website leads for you. Open the app and turn on Receive leads — notifications must stay on so offers can reach you.`;

  const { data: notification, error } = await service
    .from("notifications")
    .insert({
      agent_id: agentId,
      type: "SYSTEM_ANNOUNCEMENT",
      title,
      message,
      is_read: false,
      metadata: {
        source: "admin_dashboard",
        kind: "leads_enabled",
        deepLink: "dashboard",
        scope,
        ctaLabel: "Turn on Receive leads",
      },
    })
    .select("id, agent_id, type, title, message, related_id, metadata")
    .single();

  if (error || !notification) {
    console.error("[notifyAgentLeadsDispatchEnabled] insert failed:", error);
    return;
  }

  const push = await deliverPushNotification(notification);
  if (!push.ok) {
    console.error("[notifyAgentLeadsDispatchEnabled] push failed:", push.error);
  }
}
