import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";
import { dispatchLead } from "../_shared/dispatch/dispatch-service.ts";

/**
 * dispatch-lead (v1)
 *
 * Re-run matching for a lead (admin retry or internal).
 * Auth: service role via Authorization header OR x-inbound-api-key (same as create).
 *
 * Body: { leadId: string }
 */

function verifyAccess(req: Request): boolean {
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
    const { leadId } = await req.json();
    if (!leadId) {
      return jsonResponse({ error: "leadId is required" }, 400);
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const result = await dispatchLead(service, String(leadId));
    return jsonResponse({ success: true, dispatch: result });
  } catch (err) {
    console.error("dispatch-lead:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
