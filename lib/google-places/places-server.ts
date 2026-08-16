const AUTOCOMPLETE_URL =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const DETAILS_URL =
  "https://maps.googleapis.com/maps/api/place/details/json";

const LANDMARK_PLACE_TYPES = new Set([
  "establishment",
  "point_of_interest",
  "premise",
  "subpremise",
]);

type AddressComponent = {
  long_name?: string;
  types?: string[];
};

export type AdminGooglePlace = {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  county: string | null;
  locality: string | null;
  neighborhood: string | null;
  sublocality: string | null;
  sublocalityLevel1: string | null;
  sublocalityLevel2: string | null;
  adminAreaLevel2: string | null;
};

export type PlacesPrediction = {
  placeId: string;
  label: string;
  secondary: string;
};

function getApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    ""
  );
}

function extractAddressPart(
  components: AddressComponent[] | undefined,
  type: string,
): string | null {
  const match = components?.find((part) => part.types?.includes(type));
  return match?.long_name?.trim() || null;
}

function isLandmarkPlaceTypes(types: readonly string[] | undefined): boolean {
  if (!types?.length) return false;
  return types.some((type) => LANDMARK_PLACE_TYPES.has(type));
}

export function deriveTownAreaFromPlace(place: AdminGooglePlace): {
  town: string;
  area: string;
} {
  const county = (place.county ?? "").replace(/\s+county$/i, "").trim();
  const town =
    county ||
    (place.locality ?? "").trim() ||
    (place.adminAreaLevel2 ?? "").trim() ||
    "Kenya";
  const area =
    (place.neighborhood ?? "").trim() ||
    (place.sublocality ?? "").trim() ||
    (place.sublocalityLevel1 ?? "").trim() ||
    place.name;
  return { town, area };
}

export async function fetchPlacePredictions(
  query: string,
  sessionToken: string,
): Promise<{ predictions: PlacesPrediction[]; status: string | null }> {
  const key = getApiKey();
  if (!key) {
    return { predictions: [], status: "Location search is not configured." };
  }
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { predictions: [], status: null };
  }

  const params = new URLSearchParams({
    input: trimmed,
    types: "establishment",
    components: "country:ke",
    location: "-1.286389,36.817223",
    radius: "500000",
    sessiontoken: sessionToken,
    key,
  });

  const response = await fetch(`${AUTOCOMPLETE_URL}?${params.toString()}`);
  const json = (await response.json()) as {
    status?: string;
    predictions?: Array<{
      place_id?: string;
      types?: string[];
      structured_formatting?: {
        main_text?: string;
        secondary_text?: string;
      };
    }>;
  };

  if (json.status && json.status !== "OK" && json.status !== "ZERO_RESULTS") {
    return {
      predictions: [],
      status: "Could not search places. Try again.",
    };
  }

  const landmarks = (json.predictions ?? []).filter(
    (row) => !row.types?.length || isLandmarkPlaceTypes(row.types),
  );
  if (landmarks.length === 0) {
    return {
      predictions: [],
      status: "No landmarks found. Try a shop, church, or building.",
    };
  }

  return {
    predictions: landmarks
      .filter((row) => row.place_id)
      .map((row) => ({
        placeId: String(row.place_id),
        label: row.structured_formatting?.main_text || "Place",
        secondary: row.structured_formatting?.secondary_text || "",
      })),
    status: null,
  };
}

export async function fetchPlaceDetails(
  placeId: string,
  sessionToken: string,
  fallbackLabel: string,
  fallbackSecondary: string,
): Promise<{ place: AdminGooglePlace | null; status: string | null }> {
  const key = getApiKey();
  if (!key) {
    return { place: null, status: "Location search is not configured." };
  }

  const params = new URLSearchParams({
    place_id: placeId,
    fields: "place_id,name,formatted_address,geometry,address_component,type",
    sessiontoken: sessionToken,
    key,
  });

  const response = await fetch(`${DETAILS_URL}?${params.toString()}`);
  const json = (await response.json()) as {
    status?: string;
    result?: {
      place_id?: string;
      name?: string;
      formatted_address?: string;
      types?: string[];
      geometry?: { location?: { lat?: number; lng?: number } };
      address_components?: AddressComponent[];
    };
  };

  if (json.status !== "OK" || !json.result) {
    return {
      place: null,
      status: "Could not load that place. Try another result.",
    };
  }

  const result = json.result;
  const lat = Number(result.geometry?.location?.lat);
  const lng = Number(result.geometry?.location?.lng);
  if (!result.place_id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      place: null,
      status: "That result has no map position. Try another.",
    };
  }
  if (!isLandmarkPlaceTypes(result.types)) {
    return {
      place: null,
      status:
        "Pick a landmark such as a shop, church, or building — not a city or estate.",
    };
  }

  return {
    place: {
      placeId: result.place_id,
      name: result.name || fallbackLabel,
      formattedAddress: result.formatted_address || fallbackSecondary,
      lat,
      lng,
      county: extractAddressPart(
        result.address_components,
        "administrative_area_level_1",
      ),
      locality: extractAddressPart(result.address_components, "locality"),
      neighborhood: extractAddressPart(
        result.address_components,
        "neighborhood",
      ),
      sublocality: extractAddressPart(result.address_components, "sublocality"),
      sublocalityLevel1: extractAddressPart(
        result.address_components,
        "sublocality_level_1",
      ),
      sublocalityLevel2: extractAddressPart(
        result.address_components,
        "sublocality_level_2",
      ),
      adminAreaLevel2: extractAddressPart(
        result.address_components,
        "administrative_area_level_2",
      ),
    },
    status: null,
  };
}
