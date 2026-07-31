/**
 * Ask the admin API to deliver Expo pushes for notification rows.
 * Safe to call from client components after insert/update.
 */
export async function triggerAdminNotificationPush(
  notificationIds: string[],
): Promise<{
  ok: boolean;
  sent: number;
  error?: string;
  failed?: { id: string; error?: string }[];
}> {
  const ids = [...new Set(notificationIds.filter(Boolean))];
  if (ids.length === 0) {
    return { ok: true, sent: 0 };
  }

  try {
    const res = await fetch("/api/admin/notifications/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationIds: ids }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      sent?: number;
      error?: string;
      failed?: { id: string; error?: string }[];
    };

    if (!res.ok) {
      return {
        ok: false,
        sent: data.sent ?? 0,
        error: data.error || `Push API failed (${res.status})`,
        failed: data.failed,
      };
    }

    return {
      ok: data.success !== false && (data.failed?.length ?? 0) === 0,
      sent: data.sent ?? 0,
      error:
        (data.failed?.length ?? 0) > 0
          ? data.failed?.[0]?.error || "Some pushes failed"
          : undefined,
      failed: data.failed,
    };
  } catch (err) {
    return {
      ok: false,
      sent: 0,
      error: err instanceof Error ? err.message : "Push request failed",
    };
  }
}
