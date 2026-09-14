/**
 * Notify an agent that their Airtel Connect app account is ready.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverPushNotification } from "@/lib/dispatch/push-delivery";

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.airtel.airtelwork.africa";

export async function notifyAgentAirtelConnectOpened(
  service: SupabaseClient,
  agentId: string,
  agentName?: string | null,
): Promise<{ notified: boolean; error?: string }> {
  const firstName = agentName?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const title = "Your Airtel Connect account is ready";
  const message = [
    `${greeting} we've opened your Airtel Connect account.`,
    "",
    "GET STARTED",
    "1. Install Airtel Connect (Play Store → “Airtel Connect” / Airtel Work).",
    "2. Open the app and allow permissions.",
    "3. Sign in with your registered Airtel / agent line.",
    "4. Finish first-time setup, then keep the app updated.",
    "",
    "ORDER ID (REQUIRED)",
    "After KYC / install work in Airtel Connect, copy the Order ID.",
    "Add that Order ID in WAM Apps on the registration — it is required for installation and payment.",
    "You can paste it when finishing Connect → WAM, or later under Registrations.",
    "",
    "NEED HELP?",
    "Login or credentials issues → WAM Apps → Help.",
    "",
    `Play Store: ${PLAY_STORE_URL}`,
  ].join("\n");

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
        kind: "airtel_connect_opened",
        deepLink: "notifications",
        playStoreUrl: PLAY_STORE_URL,
        packageId: "com.airtel.airtelwork.africa",
        ctaLabel: "View instructions",
        orderIdRequired: true,
        orderIdHint:
          "Add the Airtel Connect Order ID in WAM Apps after KYC — required for installation and payment.",
      },
    })
    .select("id, agent_id, type, title, message, related_id, metadata")
    .single();

  if (error || !notification) {
    console.error("[notifyAgentAirtelConnectOpened] insert failed:", error);
    return { notified: false, error: error?.message ?? "insert_failed" };
  }

  const push = await deliverPushNotification(notification);
  if (!push.ok) {
    console.error("[notifyAgentAirtelConnectOpened] push failed:", push.error);
    return { notified: true, error: push.error };
  }

  return { notified: true };
}
