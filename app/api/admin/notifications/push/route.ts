import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { createServiceClient } from "@/lib/supabase/service";
import { deliverPushNotification } from "@/lib/dispatch/push-delivery";

export const dynamic = "force-dynamic";

/**
 * Explicitly deliver Expo pushes for notification rows.
 * Does not rely on the Database Webhook — use after admin inserts.
 */
export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  let body: { notificationIds?: unknown };
  try {
    body = (await request.json()) as { notificationIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.notificationIds)
    ? body.notificationIds
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    : [];

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "notificationIds required" },
      { status: 400 },
    );
  }

  // Cap a single blast so we don't hang the request forever.
  const capped = ids.slice(0, 200);

  try {
    const service = createServiceClient();
    const { data: rows, error } = await service
      .from("notifications")
      .select("id, agent_id, type, title, message, related_id, metadata")
      .in("id", capped);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!rows?.length) {
      return NextResponse.json(
        { error: "No notifications found for those ids" },
        { status: 404 },
      );
    }

    const results = await Promise.all(
      rows.map(async (row) => {
        const outcome = await deliverPushNotification(row);
        return { id: row.id, ...outcome };
      }),
    );

    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    return NextResponse.json({
      success: failed.length === 0,
      requested: capped.length,
      found: rows.length,
      sent,
      failed: failed.map((f) => ({ id: f.id, error: f.error })),
    });
  } catch (err) {
    console.error("[admin/notifications/push]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Push failed" },
      { status: 500 },
    );
  }
}
