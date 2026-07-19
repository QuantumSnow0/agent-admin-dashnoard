/**
 * Deliver push via send-push-notification edge function (background/killed app).
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
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!baseUrl || !serviceKey) {
    console.warn("[push-delivery] Missing Supabase env — push skipped");
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ record: notification }),
    });

    if (!res.ok) {
      console.error(
        "[push-delivery] send-push-notification failed:",
        res.status,
        await res.text(),
      );
    }
  } catch (err) {
    console.error("[push-delivery] error:", err);
  }
}
