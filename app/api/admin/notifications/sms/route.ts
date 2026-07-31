import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { sendAdminSms } from "@/lib/sms/send-admin-sms";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  let body: {
    agentIds?: unknown;
    message?: unknown;
    title?: unknown;
    recordInApp?: unknown;
    phoneTarget?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const agentIds = Array.isArray(body.agentIds)
    ? body.agentIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      )
    : [];
  const message = String(body.message ?? "").trim();
  const title = String(body.title ?? "").trim();
  const phoneTargetRaw = String(body.phoneTarget ?? "airtel").toLowerCase();
  const phoneTarget =
    phoneTargetRaw === "safaricom" || phoneTargetRaw === "both"
      ? phoneTargetRaw
      : "airtel";

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (agentIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one agent" },
      { status: 400 },
    );
  }

  const {
    data: { session },
  } = await auth.supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return NextResponse.json(
      { error: "Missing admin session — sign in again." },
      { status: 401 },
    );
  }

  const result = await sendAdminSms({
    agentIds,
    message,
    title: title || undefined,
    recordInApp: body.recordInApp !== false,
    phoneTarget,
    accessToken,
  });

  // Always 200 with structured result so the UI can show Onfon/skip reasons.
  // Use 502 only for hard transport/auth failures with zero sends.
  const hardFail = !result.ok && result.sent === 0 && !result.skipped;
  return NextResponse.json(result, {
    status: hardFail ? 502 : 200,
  });
}
