import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";

/**
 * airtel-locations-catalog
 *
 * Server-to-server catalog of canonical locations mapped to Airtel towns.
 * towns[] are the 20 operational areas (UI Installation Town).
 * Each location still carries the 14 Airtel Forms town (townKey / townLabel).
 * Uncovered locations are omitted from the list (not offered for Airtel install).
 * Lookup by id may return available: false for uncovered/unknown rows.
 *
 * Auth: x-inbound-api-key (INBOUND_LEAD_API_KEY or LOCATIONS_CATALOG_API_KEY).
 * Do not call this from the browser with the API key.
 */

type MappedRow = {
  id: string;
  province: string;
  district: string;
  division: string;
  name: string;
  display_label: string;
  slug: string;
  town_key: string;
  town_label: string;
  location_question_id: string | null;
  town_sort_order: number;
  mapping_notes: string | null;
};

function verifyApiKey(req: Request): boolean {
  const provided = req.headers.get("x-inbound-api-key")?.trim();
  if (!provided) return false;
  const expected =
    Deno.env.get("LOCATIONS_CATALOG_API_KEY")?.trim() ||
    Deno.env.get("INBOUND_LEAD_API_KEY")?.trim();
  if (!expected) {
    console.error("Catalog API key not configured");
    return false;
  }
  return provided === expected;
}

const OPERATIONAL_AREA_ORDER = [
  "Bungoma",
  "Garissa",
  "Kajiado",
  "Kakamega",
  "Kiambu",
  "Kilifi",
  "Kisii",
  "Kisumu",
  "Kwale",
  "Machakos",
  "Meru",
  "Migori",
  "Mombasa",
  "Nairobi",
  "Nakuru",
  "Nyamira",
  "Tharaka-Nithi",
  "Trans Nzoia",
  "Uasin Gishu",
  "West Pokot",
];

function operationalAreaOf(row: MappedRow): string {
  const notes = row.mapping_notes?.trim() ?? "";
  const match = notes.match(/^operational_area=(.+)$/);
  if (match?.[1]?.trim()) return match[1].trim();
  return row.town_label;
}

function toLocation(row: MappedRow) {
  const operationalArea = operationalAreaOf(row);
  return {
    id: row.id,
    province: row.province,
    district: row.district,
    division: row.division,
    name: row.name,
    displayLabel: row.display_label,
    slug: row.slug,
    townKey: row.town_key,
    townLabel: operationalArea,
    airtelTownLabel: row.town_label,
    locationQuestionId: row.location_question_id,
    operationalArea,
    available: true,
  };
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!verifyApiKey(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const service = createClient(supabaseUrl, serviceKey);
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  const name = url.searchParams.get("name")?.trim();

  try {
    if (id) {
      const { data: mapped, error } = await service
        .from("airtel_mapped_locations")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        console.error("catalog lookup mapped:", error);
        return jsonResponse({ error: "Failed to load location" }, 500);
      }

      if (mapped) {
        return jsonResponse({ location: toLocation(mapped as MappedRow) });
      }

      const { data: canonical, error: locError } = await service
        .from("locations")
        .select("id, province, district, division, name, display_label, slug")
        .eq("id", id)
        .maybeSingle();

      if (locError) {
        console.error("catalog lookup canonical:", locError);
        return jsonResponse({ error: "Failed to load location" }, 500);
      }

      if (!canonical) {
        return jsonResponse({ error: "Not found" }, 404);
      }

      return jsonResponse({
        location: {
          id: canonical.id,
          province: canonical.province,
          district: canonical.district,
          division: canonical.division,
          name: canonical.name,
          displayLabel: canonical.display_label,
          slug: canonical.slug,
          townKey: null,
          townLabel: null,
          airtelTownLabel: null,
          locationQuestionId: null,
          operationalArea: null,
          available: false,
        },
      });
    }

    const pageSize = 1000;
    const rows: MappedRow[] = [];
    let from = 0;
    while (true) {
      let pageQuery = service
        .from("airtel_mapped_locations")
        .select("*")
        .order("town_sort_order", { ascending: true })
        .order("display_label", { ascending: true })
        .range(from, from + pageSize - 1);
      if (name) {
        pageQuery = pageQuery.ilike("name", name);
      }
      const { data, error } = await pageQuery;
      if (error) {
        console.error("catalog list:", error);
        return jsonResponse({ error: "Failed to load catalog" }, 500);
      }
      const page = (data ?? []) as MappedRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }
    const townMap = new Map<
      string,
      {
        townKey: string;
        townLabel: string;
        airtelTownLabel: string;
        operationalArea: string;
        locationQuestionId: string | null;
        sortOrder: number;
      }
    >();
    for (const row of rows) {
      const operationalArea = operationalAreaOf(row);
      if (!townMap.has(operationalArea)) {
        const orderIndex = OPERATIONAL_AREA_ORDER.indexOf(operationalArea);
        townMap.set(operationalArea, {
          townKey: row.town_key,
          townLabel: operationalArea,
          airtelTownLabel: row.town_label,
          operationalArea,
          locationQuestionId: row.location_question_id,
          sortOrder: orderIndex === -1 ? 999 : orderIndex,
        });
      }
    }

    const towns = [...townMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);

    return jsonResponse({
      towns: towns.map(({ sortOrder: _sortOrder, ...town }) => town),
      locations: rows.map(toLocation),
      counts: {
        towns: towns.length,
        locations: rows.length,
      },
    });
  } catch (err) {
    console.error("airtel-locations-catalog:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
