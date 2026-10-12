import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import { dispatchLead, loadDispatchConfig } from "../_shared/dispatch/dispatch-service.ts";
import { expireStaleOffers } from "../_shared/dispatch/expire-offers.ts";
import { normalizePhoneKey } from "../_shared/dispatch/geo.ts";
import {
  BLOCKING_LEAD_STATUSES,
  isUniqueViolation,
  planInboundWrite,
} from "../_shared/dispatch/inbound-write.ts";

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
  /** Canonical public.locations.id when the website resolved Airtel coverage. */
  installationLocationId?: string | null;
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

/**
 * Keep working after the response is sent. The website only needs the saved
 * lead id; agent matching and push delivery continue here, in the same order
 * and with the same code as before, without the customer waiting on them.
 */
function continueInBackground(task: () => Promise<unknown>): void {
  const work = task().catch((err) => console.error("create-inbound-lead background:", err));
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
}

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
    const externalId = body.sourceExternalId?.trim() || null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(supabaseUrl, serviceKey);

    // Independent lookups run together instead of one after another.
    const [externalLookup, phoneLookup, dispatchConfig] = await Promise.all([
      externalId
        ? service
            .from("inbound_leads")
            .select("id, status")
            .eq("source", source)
            .eq("source_external_id", externalId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      service
        .from("inbound_leads")
        .select("id, status")
        .eq("dedupe_phone_key", dedupeKey)
        .in("status", [...BLOCKING_LEAD_STATUSES])
        .limit(1)
        .maybeSingle(),
      loadDispatchConfig(service),
    ]);
    const existingByExternalId = externalLookup.data;
    const existingByPhone = phoneLookup.data;

    const decision = planInboundWrite({
      externalId,
      existingByExternalId,
      existingByPhone,
    });
    if (decision.action === "replay") {
      return jsonResponse({
        success: true,
        duplicate: true,
        leadId: decision.leadId,
        existingLeadId: decision.leadId,
        status: decision.status,
        dispatch: { outcome: "skipped", reason: "duplicate_submission" },
      });
    }
    const metadata: Record<string, unknown> = { ...(body.metadata ?? {}) };
    if (decision.action === "insert" && decision.duplicateOfLeadId) {
      metadata.duplicateOfLeadId = decision.duplicateOfLeadId;
      metadata.duplicateMatch = "phone";
    }
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
      source_external_id: externalId,
      product,
      status: "pending_dispatch",
      county: body.county?.trim() || null,
      installation_town: installationTown,
      installation_area: body.installationArea?.trim() || null,
      installation_location_id: body.installationLocationId?.trim() || null,
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

    if (isUniqueViolation(insertError) && externalId) {
      const { data: raced } = await service
        .from("inbound_leads")
        .select("id, status")
        .eq("source", source)
        .eq("source_external_id", externalId)
        .maybeSingle();
      if (raced) {
        return jsonResponse({
          success: true,
          duplicate: true,
          leadId: raced.id,
          existingLeadId: raced.id,
          status: raced.status,
          dispatch: { outcome: "skipped", reason: "duplicate_submission" },
        });
      }
    }

    if (insertError || !lead) {
      console.error("insert inbound_leads:", insertError);
      return jsonResponse({ error: "Failed to create lead" }, 500);
    }

    const flaggedDuplicate = decision.action === "insert" && Boolean(decision.duplicateOfLeadId);

    // The lead is saved; answer the website now. Matching the agent, the
    // push notification, and the stale-offer sweep continue after the response.
    const dispatch = dispatchConfig.dispatch_enabled
      ? { outcome: "queued", reason: "background_dispatch" }
      : { outcome: "skipped", reason: "dispatch_disabled" };

    continueInBackground(async () => {
      await dispatchLead(service, lead.id, { skipSweep: true });
      await expireStaleOffers(service, dispatchLead);
    });

    return jsonResponse({
      success: true,
      leadId: lead.id,
      duplicate: flaggedDuplicate,
      matchedLeadId: flaggedDuplicate ? decision.duplicateOfLeadId : null,
      dispatch,
    });
  } catch (err) {
    console.error("create-inbound-lead:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
