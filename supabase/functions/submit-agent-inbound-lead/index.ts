import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import { dispatchLead } from "../_shared/dispatch/dispatch-service.ts";
import { normalizePhoneKey } from "../_shared/dispatch/geo.ts";
import { parsePreviewGooglePlace } from "../_shared/dispatch/matching.ts";

/**
 * submit-agent-inbound-lead
 *
 * Authenticated agent submits an Airtel interest lead (no install / no Connect).
 * Same customer fields as Airtel registration + visit date/time; no Order ID.
 * Requires Google Places landmark (same pin shape as website leads) for dispatch.
 */

type Body = {
  customerName?: string;
  primaryPhone?: string;
  alternatePhone?: string | null;
  email?: string | null;
  installationTown?: string;
  installationArea?: string | null;
  deliveryLandmark?: string | null;
  county?: string | null;
  preferredPackage?: string | null;
  unitsRequired?: number | null;
  visitDate?: string | null;
  visitTime?: string | null;
  googlePlace?: unknown;
};

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const service = createClient(supabaseUrl, serviceKey);

    const { data: agent, error: agentError } = await service
      .from("agents")
      .select("id, status")
      .eq("id", user.id)
      .maybeSingle();

    if (agentError || !agent) {
      return jsonResponse({ error: "Agent profile not found" }, 403);
    }
    if (agent.status !== "approved") {
      return jsonResponse({ error: "Account must be approved to submit leads" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const customerName = String(body.customerName ?? "").trim();
    const primaryPhone = String(body.primaryPhone ?? "").trim();
    const email = String(body.email ?? "").trim();
    const installationTown = String(body.installationTown ?? "").trim();
    const preferredPackage = String(body.preferredPackage ?? "").trim().toLowerCase();
    const visitDate = String(body.visitDate ?? "").trim();
    const visitTime = String(body.visitTime ?? "").trim();
    const unitsRequired = Number(body.unitsRequired);

    const googlePlaceRaw =
      body.googlePlace && typeof body.googlePlace === "object"
        ? (body.googlePlace as Record<string, unknown>)
        : null;
    const googlePlace = parsePreviewGooglePlace(googlePlaceRaw);
    const deliveryLandmark =
      String(body.deliveryLandmark ?? "").trim() ||
      googlePlace?.name?.trim() ||
      "";
    const county =
      String(body.county ?? "").trim() ||
      (googlePlace?.county ? String(googlePlace.county).trim() : "") ||
      null;
    const installationArea =
      String(body.installationArea ?? "").trim() ||
      (googlePlaceRaw?.neighborhood
        ? String(googlePlaceRaw.neighborhood).trim()
        : "") ||
      (googlePlaceRaw?.sublocalityLevel1
        ? String(googlePlaceRaw.sublocalityLevel1).trim()
        : "") ||
      (googlePlaceRaw?.sublocality
        ? String(googlePlaceRaw.sublocality).trim()
        : "") ||
      null;

    const missing: string[] = [];
    if (!customerName) missing.push("customerName");
    if (!primaryPhone) missing.push("primaryPhone");
    if (!email) missing.push("email");
    if (!installationTown) missing.push("installationTown");
    if (!googlePlace) missing.push("googlePlace");
    if (!deliveryLandmark) missing.push("deliveryLandmark");
    if (!["standard", "premium"].includes(preferredPackage)) {
      missing.push("preferredPackage");
    }
    if (!Number.isInteger(unitsRequired) || unitsRequired < 1 || unitsRequired > 2) {
      missing.push("unitsRequired");
    }
    if (!visitDate) missing.push("visitDate");
    if (!visitTime) missing.push("visitTime");
    if (missing.length > 0) {
      return jsonResponse(
        { error: "Validation failed", fields: missing },
        400,
      );
    }

    const dedupeKey = normalizePhoneKey(primaryPhone);
    if (!dedupeKey) {
      return jsonResponse({ error: "Invalid phone number" }, 400);
    }

    const blockingStatuses = [
      "pending_dispatch",
      "offered",
      "assigned",
      "kyc_in_progress",
      "kyc_completed",
      "needs_reassignment",
      "admin_queue",
      "deferred",
      "pending_install",
    ];
    const { data: existing } = await service
      .from("inbound_leads")
      .select("id, status")
      .eq("dedupe_phone_key", dedupeKey)
      .in("status", blockingStatuses)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return jsonResponse(
        {
          success: false,
          duplicate: true,
          existingLeadId: existing.id,
          message: "An active lead already exists for this phone number",
        },
        409,
      );
    }

    // Store full place payload (incl. locality fields) like website leads.
    const googlePlaceMeta = {
      placeId: googlePlace!.placeId,
      name: googlePlace!.name,
      formattedAddress: googlePlace!.formattedAddress,
      lat: googlePlace!.lat,
      lng: googlePlace!.lng,
      county: googlePlace!.county ?? null,
      locality: googlePlaceRaw?.locality
        ? String(googlePlaceRaw.locality)
        : null,
      neighborhood: googlePlaceRaw?.neighborhood
        ? String(googlePlaceRaw.neighborhood)
        : null,
      sublocality: googlePlaceRaw?.sublocality
        ? String(googlePlaceRaw.sublocality)
        : null,
      sublocalityLevel1: googlePlaceRaw?.sublocalityLevel1
        ? String(googlePlaceRaw.sublocalityLevel1)
        : null,
      sublocalityLevel2: googlePlaceRaw?.sublocalityLevel2
        ? String(googlePlaceRaw.sublocalityLevel2)
        : null,
      adminAreaLevel2: googlePlaceRaw?.adminAreaLevel2
        ? String(googlePlaceRaw.adminAreaLevel2)
        : null,
    };

    const row = {
      source: "agent_own",
      product: "airtel",
      status: "pending_dispatch",
      county,
      installation_town: installationTown,
      installation_area: installationArea || null,
      delivery_landmark: deliveryLandmark,
      customer_name: customerName,
      primary_phone: primaryPhone,
      alternate_phone: String(body.alternatePhone ?? "").trim() || null,
      email,
      preferred_package: preferredPackage,
      visit_date: visitDate,
      visit_time: visitTime,
      dedupe_phone_key: dedupeKey,
      submitted_by_agent_id: user.id,
      metadata: {
        submitted_by_agent_id: user.id,
        unitsRequired,
        googlePlace: googlePlaceMeta,
      },
    };

    const { data: lead, error: insertError } = await service
      .from("inbound_leads")
      .insert(row)
      .select("id")
      .single();

    if (insertError || !lead) {
      console.error("submit-agent-inbound-lead insert:", insertError);
      return jsonResponse({ error: "Failed to create lead" }, 500);
    }

    const dispatchResult = await dispatchLead(service, lead.id, {
      excludeAgentIds: [user.id],
    });

    return jsonResponse({
      success: true,
      leadId: lead.id,
      dispatch: dispatchResult,
    });
  } catch (err) {
    console.error("submit-agent-inbound-lead:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
