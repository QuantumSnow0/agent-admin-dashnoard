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

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error("lead-offer-action: missing env secrets");
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      console.error("lead-offer-action auth:", userError?.message);
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

    // Idempotent accept: already accepted by this agent → return full lead.
    if (action === "accept" && offer.status === "accepted") {
      const { data: existingLead } = await service
        .from("inbound_leads")
        .select("*")
        .eq("id", offer.lead_id)
        .single();

      if (
        existingLead &&
        existingLead.assigned_agent_id === user.id
      ) {
        return jsonResponse({
          success: true,
          action: "accepted",
          lead: existingLead,
          idempotent: true,
        });
      }
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
      try {
        await dispatchLead(service, offer.lead_id, {
          excludeAgentIds: [user.id],
        });
      } catch (dispatchErr) {
        console.error("lead-offer-action expire dispatch:", dispatchErr);
      }
      return jsonResponse({ error: "Offer expired" }, 410);
    }

    if (action === "decline") {
      const { error: declineError } = await service
        .from("lead_offers")
        .update({ status: "declined", responded_at: now.toISOString() })
        .eq("id", offerId);

      if (declineError) {
        console.error("lead-offer-action decline:", declineError);
        return jsonResponse({ error: "Failed to decline offer" }, 500);
      }

      let dispatchResult;
      try {
        dispatchResult = await dispatchLead(service, offer.lead_id, {
          excludeAgentIds: [user.id],
        });
      } catch (dispatchErr) {
        console.error("lead-offer-action decline dispatch:", dispatchErr);
        dispatchResult = { outcome: "skipped", reason: "dispatch_error" };
      }

      return jsonResponse({
        success: true,
        action: "declined",
        dispatch: dispatchResult,
      });
    }

    // accept
    const { error: acceptOfferError } = await service
      .from("lead_offers")
      .update({ status: "accepted", responded_at: now.toISOString() })
      .eq("id", offerId)
      .eq("status", "offered");

    if (acceptOfferError) {
      console.error("lead-offer-action accept offer:", acceptOfferError);
      return jsonResponse({ error: "Failed to accept offer" }, 500);
    }

    await service
      .from("lead_offers")
      .update({ status: "superseded", responded_at: now.toISOString() })
      .eq("lead_id", offer.lead_id)
      .eq("status", "offered")
      .neq("id", offerId);

    const { data: fullLead, error: assignError } = await service
      .from("inbound_leads")
      .update({
        status: "assigned",
        assigned_agent_id: user.id,
        accepted_at: now.toISOString(),
      })
      .eq("id", offer.lead_id)
      .select("*")
      .single();

    if (assignError || !fullLead) {
      console.error("lead-offer-action assign lead:", assignError);
      return jsonResponse(
        {
          error:
            assignError?.message?.includes("foreign key") ||
            assignError?.code === "23503"
              ? "Agent profile missing — contact support"
              : "Failed to assign lead",
        },
        500,
      );
    }

    return jsonResponse({
      success: true,
      action: "accepted",
      lead: fullLead,
    });
  } catch (err) {
    console.error("lead-offer-action:", err);
    return jsonResponse(
      {
        error:
          err instanceof Error ? err.message : "Internal server error",
      },
      500,
    );
  }
});
