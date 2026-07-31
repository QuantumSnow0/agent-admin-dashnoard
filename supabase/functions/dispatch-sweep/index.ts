import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import { sweepDispatchQueue } from "../_shared/dispatch/dispatch-service.ts";

/**
 * dispatch-sweep
 *
 * Expire timed-out offers and re-dispatch without relying on agent heartbeats.
 * Auth: service role Bearer, x-inbound-api-key, or x-cron-secret.
 *
 * Intended to run every 1–2 minutes via pg_cron / Supabase scheduled function.
 */

function verifyAccess(req: Request): boolean {
  const cronSecret = Deno.env.get("DISPATCH_SWEEP_CRON_SECRET");
  const providedCron = req.headers.get("x-cron-secret");
  if (cronSecret && providedCron === cronSecret) return true;

  const apiKey = Deno.env.get("INBOUND_LEAD_API_KEY");
  const providedKey = req.headers.get("x-inbound-api-key");
  if (apiKey && providedKey === apiKey) return true;

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceKey && token === serviceKey) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!verifyAccess(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const sweep = await sweepDispatchQueue(service);
    return jsonResponse({ success: true, sweep });
  } catch (err) {
    console.error("dispatch-sweep:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
