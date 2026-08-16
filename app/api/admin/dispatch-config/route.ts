import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { DISPATCH_DEFAULTS } from "@/lib/dispatch/constants";
import { clampServiceRadiusKm } from "@/lib/dispatch/matching";

type Body = { default_service_radius_km?: number };

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = Number(body.default_service_radius_km);
  if (!Number.isFinite(raw) || raw <= 0) {
    return NextResponse.json(
      { error: "Enter a radius between 0.5 and 50 km" },
      { status: 400 },
    );
  }
  const km = clampServiceRadiusKm(raw);

  try {
    const service = createServiceClient();
    const { data: existing } = await service
      .from("dispatch_config")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (!existing?.id) {
      return NextResponse.json(
        { error: "Dispatch config row is missing" },
        { status: 500 },
      );
    }

    const { data, error } = await service
      .from("dispatch_config")
      .update({ default_service_radius_km: km })
      .eq("id", existing.id)
      .select("default_service_radius_km")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      default_service_radius_km:
        Number(data.default_service_radius_km) ||
        DISPATCH_DEFAULTS.defaultServiceRadiusKm,
    });
  } catch (err) {
    console.error("[admin/dispatch-config]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
