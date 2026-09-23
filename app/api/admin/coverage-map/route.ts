import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import {
  loadDefaultRadiusKm,
  loadPinCircles,
  loadZoneRows,
} from "@/lib/dispatch/coverage-admin";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  try {
    const service = createServiceClient();
    const defaultRadiusKm = await loadDefaultRadiusKm(service);
    const [zones, pins] = await Promise.all([
      loadZoneRows(service, { inboundOnly: true }),
      loadPinCircles(service, defaultRadiusKm),
    ]);
    return NextResponse.json({ zones, pins, defaultRadiusKm });
  } catch (err) {
    console.error("[admin/coverage-map]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
