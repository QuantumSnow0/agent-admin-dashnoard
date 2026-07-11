import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import { dispatchLead } from "../_shared/dispatch/dispatch-service.ts";

/**
 * lead-offer-action (v1)
 *
 * Agent accepts or declines a blind lead offer.
 * Auth: agent JWT (verify_jwt = true).
 *
 * Body: { offerId: string, action: "accept" | "decline" }
 *
 * On accept → full lead returned, assigned_agent_id set.
 * On decline / expired → dispatch next nearest agent in county.
 */

type Body = { offerId?: string; action?: string };

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
    const body = (await req.json()) as Body;
    const offerId = String(body.offerId ?? "").trim();
    const action = String(body.action ?? "").trim();

    if (!offerId || !["accept", "decline"].includes(action)) {
      return jsonResponse(
        { error: "offerId and action (accept|decline) are required" },
        400,
      );
    }

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

    const { data: offer, error: offerError } = await service
      .from("lead_offers")
      .select("*")
      .eq("id", offerId)
      .single();

    if (offerError || !offer) {
      return jsonResponse({ error: "Offer not found" }, 404);
    }

    if (offer.agent_id !== user.id) {
      return jsonResponse({ error: "Not your offer" }, 403);
    }

    if (offer.status !== "offered") {
      return jsonResponse({ error: `Offer is ${offer.status}` }, 409);
    }

    const now = new Date();
    if (new Date(offer.expires_at) < now) {
      await service
        .from("lead_offers")
        .update({ status: "expired", responded_at: now.toISOString() })
        .eq("id", offerId);
      await dispatchLead(service, offer.lead_id);
      return jsonResponse({ error: "Offer expired" }, 410);
    }

    if (action === "decline") {
      await service
        .from("lead_offers")
        .update({ status: "declined", responded_at: now.toISOString() })
        .eq("id", offerId);

      const dispatchResult = await dispatchLead(service, offer.lead_id);
      return jsonResponse({
        success: true,
        action: "declined",
        dispatch: dispatchResult,
      });
    }

    // accept
    await service
      .from("lead_offers")
      .update({ status: "accepted", responded_at: now.toISOString() })
      .eq("id", offerId);

    await service
      .from("lead_offers")
      .update({ status: "superseded", responded_at: now.toISOString() })
      .eq("lead_id", offer.lead_id)
      .eq("status", "offered")
      .neq("id", offerId);

    await service
      .from("inbound_leads")
      .update({
        status: "assigned",
        assigned_agent_id: user.id,
        accepted_at: now.toISOString(),
      })
      .eq("id", offer.lead_id);

    const { data: fullLead } = await service
      .from("inbound_leads")
      .select("*")
      .eq("id", offer.lead_id)
      .single();

    return jsonResponse({
      success: true,
      action: "accepted",
      lead: fullLead,
    });
  } catch (err) {
    console.error("lead-offer-action:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
