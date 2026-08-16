import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { fetchPlaceDetails } from "@/lib/google-places/places-server";

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("placeId") ?? "";
  const sessionToken = searchParams.get("session") ?? crypto.randomUUID();
  const label = searchParams.get("label") ?? "Place";
  const secondary = searchParams.get("secondary") ?? "";
  if (!placeId) {
    return NextResponse.json({ place: null, status: "Missing place" }, { status: 400 });
  }
  const result = await fetchPlaceDetails(placeId, sessionToken, label, secondary);
  return NextResponse.json(result);
}
