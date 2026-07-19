import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import { sweepDispatchQueue } from "../_shared/dispatch/dispatch-service.ts";

/**
 * agent-heartbeat (v1.1)
 *
 * Called by the agent app every ~60s while signed in.
 * Updates last_seen_at, sweeps expired offers, retries admin-queue leads in county.
 * No pg_cron — rotation happens on activity.
 */

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
    const now = new Date().toISOString();

    const { data: settings } = await service
      .from("agent_dispatch_settings")
      .update({ last_seen_at: now, updated_at: now })
      .eq("agent_id", user.id)
      .select("is_available, county")
      .maybeSingle();

    if (!settings) {
      await service.from("agent_dispatch_settings").insert({
        agent_id: user.id,
        last_seen_at: now,
        updated_at: now,
        is_available: false,
      });
    }

    const county = settings?.is_available ? settings.county : null;
    const sweep = await sweepDispatchQueue(service, { county });

    return jsonResponse({
      success: true,
      lastSeenAt: now,
      sweep,
    });
  } catch (err) {
    console.error("agent-heartbeat:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
