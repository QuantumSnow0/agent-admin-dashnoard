// Supabase Edge Function: Send Push Notification
// Called when a notification is created — delivers MD3 lead-offer alerts via Expo Push API.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { LeadOfferPreview } from "../_shared/dispatch/lead-offer-notification-copy.ts";
import {
  buildLeadOfferExpoPushPayload,
  buildLeadOfferPushCopy,
} from "../_shared/dispatch/lead-offer-push-payload.ts";

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";
const LEAD_OFFER_CHANNEL_ID = "wam_lead_offers_v9";

type ExpoTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

function expoTicketsFailed(result: unknown): string | null {
  const tickets: ExpoTicket[] = Array.isArray((result as { data?: unknown })?.data)
    ? ((result as { data: ExpoTicket[] }).data ?? [])
    : [(result as { data?: ExpoTicket })?.data ?? (result as ExpoTicket)];

  for (const ticket of tickets) {
    if (ticket?.status === "error") {
      return ticket.message ?? ticket.details?.error ?? "Expo push ticket error";
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const rawBody = await req.text();
    let webhookData: Record<string, unknown>;
    try {
      webhookData = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const notification = (webhookData.record ?? webhookData.notification) as
      | Record<string, unknown>
      | undefined;

    if (!notification?.agent_id) {
      return new Response(
        JSON.stringify({ error: "Missing notification or agent_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const notificationId = String(notification.id ?? "");
    const agentId = String(notification.agent_id);

    // Dedupe check only — do NOT insert until Expo accepts the push (see below).
    if (notificationId) {
      const { data: existingReceipt } = await supabase
        .from("notification_push_receipts")
        .select("notification_id")
        .eq("notification_id", notificationId)
        .maybeSingle();

      if (existingReceipt) {
        return new Response(JSON.stringify({ success: true, deduped: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const { data: deviceTokens, error: tokensError } = await supabase
      .from("device_tokens")
      .select("token, device_type")
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .order("last_used_at", { ascending: false })
      .limit(1);

    if (tokensError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch device tokens" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!deviceTokens?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No device tokens found" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const isLeadOffer = notification.type === "LEAD_OFFER";

    const pushNotifications = await Promise.all(
      deviceTokens.map(async (dt) => {
        const leadSound =
          dt.device_type === "ios" ? "lead_push_alert.wav" : "lead_push_alert";

        if (!isLeadOffer) {
          return {
            to: dt.token,
            sound: "default",
            title: notification.title,
            body: notification.message,
            data: {
              type: notification.type,
              notificationId,
              relatedId: notification.related_id,
              metadata: notification.metadata || {},
            },
            badge: 1,
            priority: "high",
            ...(dt.device_type !== "ios" ? { channelId: "wam_alerts" } : {}),
          };
        }

        const metadata = (notification.metadata ?? {}) as Record<string, unknown>;
        const preview = (metadata.preview ?? {}) as LeadOfferPreview;
        const offerId = metadata.offerId ? String(metadata.offerId) : undefined;

        const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { data: pendingRows } = await supabase
          .from("notifications")
          .select("id, metadata, created_at")
          .eq("agent_id", agentId)
          .eq("type", "LEAD_OFFER")
          .eq("is_read", false)
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(5);

        const copy = buildLeadOfferPushCopy(
          pendingRows ?? [],
          preview,
          pendingRows?.length ?? 1,
        );

        return buildLeadOfferExpoPushPayload({
          token: dt.token,
          deviceType: dt.device_type,
          notificationId,
          relatedId: notification.related_id
            ? String(notification.related_id)
            : undefined,
          offerId,
          preview,
          copy,
          leadOfferChannelId: LEAD_OFFER_CHANNEL_ID,
          leadSound,
          fallbackTitle: String(notification.title ?? ""),
          fallbackMessage: String(notification.message ?? ""),
        });
      }),
    );

    const response = await fetch(EXPO_PUSH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(pushNotifications),
    });

    const result = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to send push notification", details: result }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const ticketError = expoTicketsFailed(result);
    if (ticketError) {
      return new Response(
        JSON.stringify({ error: "Expo push rejected", details: result, message: ticketError }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    if (notificationId) {
      await supabase.from("notification_push_receipts").insert({
        notification_id: notificationId,
      });
    }

    return new Response(
      JSON.stringify({ success: true, sent: pushNotifications.length, result }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
