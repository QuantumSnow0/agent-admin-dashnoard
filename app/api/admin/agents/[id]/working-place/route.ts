import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import {
  deriveTownAreaFromPlace,
  type AdminGooglePlace,
} from "@/lib/google-places/places-server";
import { parsePreviewGooglePlace } from "@/lib/dispatch/matching";

type Body = { place?: AdminGooglePlace };

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { id: agentId } = await context.params;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parsePreviewGooglePlace(body.place);
  if (!parsed) {
    return NextResponse.json(
      { error: "Select a landmark from the search results" },
      { status: 400 },
    );
  }

  const place: AdminGooglePlace = {
    placeId: parsed.placeId,
    name: parsed.name,
    formattedAddress: parsed.formattedAddress,
    lat: parsed.lat,
    lng: parsed.lng,
    county: body.place?.county ?? parsed.county ?? null,
    locality: body.place?.locality ?? null,
    neighborhood: body.place?.neighborhood ?? null,
    sublocality: body.place?.sublocality ?? null,
    sublocalityLevel1: body.place?.sublocalityLevel1 ?? null,
    sublocalityLevel2: body.place?.sublocalityLevel2 ?? null,
    adminAreaLevel2: body.place?.adminAreaLevel2 ?? null,
  };
  const { town, area } = deriveTownAreaFromPlace(place);
  const updatedAt = new Date().toISOString();

  try {
    const service = createServiceClient();
    const { data: agent, error } = await service
      .from("agents")
      .update({
        working_place: place,
        working_place_updated_at: updatedAt,
        town,
        area,
        updated_at: updatedAt,
      })
      .eq("id", agentId)
      .select("id, working_place, working_place_updated_at, town, area")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, agent });
  } catch (err) {
    console.error("[admin/agents/working-place]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
