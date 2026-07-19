/**
 * Deliver push via send-push-notification edge function (background/killed app).
 * Do not rely on DB webhooks alone — invoke directly after notification insert.
 */

type NotificationRow = {
  id: string;
  agent_id: string;
  type: string;
  title: string;
  message: string;
  related_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function deliverPushNotification(
  notification: NotificationRow,
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    console.error("[push-delivery] Missing SUPABASE_URL or SERVICE_ROLE_KEY");
    return;
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ record: notification }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[push-delivery] send-push-notification failed:", res.status, body);
      return;
    }

    const result = await res.json().catch(() => ({}));
    console.log("[push-delivery] sent", notification.id, result);
  } catch (err) {
    console.error("[push-delivery] error:", err);
  }
}
