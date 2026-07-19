import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { sweepDispatchQueue } from "@/lib/dispatch/dispatch-service";

/**
 * POST /api/admin/dispatch/sweep
 * Expire timed-out offers and re-offer to next agents (no cron).
 * Called by admin leads poll while dashboard is open.
 */
export async function POST() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  try {
    const service = createServiceClient();
    const sweep = await sweepDispatchQueue(service);
    return NextResponse.json({ success: true, sweep });
  } catch (err) {
    console.error("[admin/dispatch/sweep]", err);
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
