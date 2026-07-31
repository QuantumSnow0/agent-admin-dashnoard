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

export type PushDeliveryResult = {
  ok: boolean;
  error?: string;
  deduped?: boolean;
};

export async function deliverPushNotification(
  notification: NotificationRow,
): Promise<PushDeliveryResult> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!baseUrl || !serviceKey) {
    console.warn("[push-delivery] Missing Supabase env — push skipped");
    return {
      ok: false,
      error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    };
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

    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const detail =
        (parsed && typeof parsed.error === "string" && parsed.error) ||
        (parsed && typeof parsed.message === "string" && parsed.message) ||
        text ||
        `HTTP ${res.status}`;
      console.error("[push-delivery] send-push-notification failed:", res.status, text);
      return { ok: false, error: detail };
    }

    if (parsed?.deduped === true) {
      return { ok: true, deduped: true };
    }

    // Edge function returns 200 with "No device tokens found" — treat as soft fail so admin sees it.
    if (
      typeof parsed?.message === "string" &&
      parsed.message.toLowerCase().includes("no device tokens")
    ) {
      return { ok: false, error: "No active device tokens for agent" };
    }

    return { ok: true };
  } catch (err) {
    console.error("[push-delivery] error:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Push request failed",
    };
  }
}
