import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import { dispatchLead } from "../_shared/dispatch/dispatch-service.ts";
import { normalizePhoneKey } from "../_shared/dispatch/geo.ts";

/**
 * create-inbound-lead (v1)
 *
 * Called by marketing websites after saving locally.
 * Auth: x-inbound-api-key header (set INBOUND_LEAD_API_KEY secret).
 *
 * Future: webhook signatures per source, rate limits, Savanna product.
 */

type InboundBody = {
  source?: string;
  sourceExternalId?: string | null;
  product?: string;
  customerName?: string;
  primaryPhone?: string;
  alternatePhone?: string | null;
  email?: string | null;
  installationTown?: string;
  installationArea?: string | null;
  deliveryLandmark?: string | null;
  county?: string | null;
  preferredPackage?: string | null;
  planLabel?: string | null;
  planGroup?: string | null;
  visitDate?: string | null;
  visitTime?: string | null;
  nationalId?: string | null;
  dateOfBirth?: string | null;
  /** Microsoft Forms response id from website signup (Airtel). */
  msFormsResponseId?: string | number | null;
  msFormsSubmittedAt?: string | null;
  metadata?: Record<string, unknown>;
};

const VALID_SOURCES = new Set(["airtel5grouter", "internetkenya", "agent_own"]);
const VALID_PRODUCTS = new Set(["airtel", "safaricom"]);

function verifyApiKey(req: Request): boolean {
  const expected = Deno.env.get("INBOUND_LEAD_API_KEY");
  if (!expected) {
    console.error("INBOUND_LEAD_API_KEY not configured");
    return false;
  }
  const provided = req.headers.get("x-inbound-api-key");
  return provided === expected;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!verifyApiKey(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const body = (await req.json()) as InboundBody;

    const source = String(body.source ?? "").trim();
    const product = String(body.product ?? "").trim();
    const customerName = String(body.customerName ?? "").trim();
    const primaryPhone = String(body.primaryPhone ?? "").trim();
    const installationTown = String(body.installationTown ?? "").trim();

    if (!VALID_SOURCES.has(source)) {
      return jsonResponse({ error: "Invalid source" }, 400);
    }
    if (!VALID_PRODUCTS.has(product)) {
      return jsonResponse({ error: "Invalid product" }, 400);
    }
    if (!customerName || !primaryPhone || !installationTown) {
      return jsonResponse(
        { error: "customerName, primaryPhone, installationTown are required" },
        400,
      );
    }

    const dedupeKey = normalizePhoneKey(primaryPhone);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(supabaseUrl, serviceKey);

    // Dedupe: block if same phone has an active lead in flight
    const blockingStatuses = [
      "pending_dispatch",
      "offered",
      "assigned",
      "kyc_in_progress",
      "kyc_completed",
      "needs_reassignment",
      "admin_queue",
    ];
    const { data: existing } = await service
      .from("inbound_leads")
      .select("id, status")
      .eq("dedupe_phone_key", dedupeKey)
      .in("status", blockingStatuses)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return jsonResponse({
        success: false,
        duplicate: true,
        existingLeadId: existing.id,
        message: "An active lead already exists for this phone number",
      }, 409);
    }

    const metadata = body.metadata ?? {};
    const msFromMeta = metadata.msFormsResponseId;
    const msFormsResponseIdRaw =
      body.msFormsResponseId ?? msFromMeta ?? null;
    const msFormsResponseId =
      msFormsResponseIdRaw != null && String(msFormsResponseIdRaw).trim() !== ""
        ? String(msFormsResponseIdRaw)
        : null;
    const msFormsSubmittedAt =
      msFormsResponseId
        ? (body.msFormsSubmittedAt?.trim() || new Date().toISOString())
        : null;

    const row = {
      source,
      source_external_id: body.sourceExternalId ?? null,
      product,
      status: "pending_dispatch",
      county: body.county?.trim() || null,
      installation_town: installationTown,
      installation_area: body.installationArea?.trim() || null,
      delivery_landmark: body.deliveryLandmark?.trim() || null,
      customer_name: customerName,
      primary_phone: primaryPhone,
      alternate_phone: body.alternatePhone?.trim() || null,
      email: body.email?.trim() || null,
      preferred_package: body.preferredPackage?.trim() || null,
      plan_label: body.planLabel?.trim() || null,
      plan_group: body.planGroup?.trim() || null,
      visit_date: body.visitDate || null,
      visit_time: body.visitTime?.trim() || null,
      national_id: body.nationalId?.trim() || null,
      date_of_birth: body.dateOfBirth || null,
      dedupe_phone_key: dedupeKey,
      ms_forms_response_id: msFormsResponseId,
      ms_forms_submitted_at: msFormsSubmittedAt,
      metadata,
    };

    const { data: lead, error: insertError } = await service
      .from("inbound_leads")
      .insert(row)
      .select("id")
      .single();

    if (insertError || !lead) {
      console.error("insert inbound_leads:", insertError);
      return jsonResponse({ error: "Failed to create lead" }, 500);
    }

    const dispatchResult = await dispatchLead(service, lead.id);

    return jsonResponse({
      success: true,
      leadId: lead.id,
      dispatch: dispatchResult,
    });
  } catch (err) {
    console.error("create-inbound-lead:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
