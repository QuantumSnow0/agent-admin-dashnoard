import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { fetchPlacePredictions } from "@/lib/google-places/places-server";

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const sessionToken = searchParams.get("session") ?? crypto.randomUUID();
  const result = await fetchPlacePredictions(q, sessionToken);
  return NextResponse.json(result);
}
