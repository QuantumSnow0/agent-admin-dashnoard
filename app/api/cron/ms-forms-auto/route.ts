import { NextResponse } from "next/server";
import { processPendingAutoMSForms } from "@/lib/super-admin-ms-forms";

/**
 * Vercel Cron (or manual call with CRON_SECRET) processes pending MS Forms
 * when submission_mode is auto. No agent app update required.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await processPendingAutoMSForms(50);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Worker failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
