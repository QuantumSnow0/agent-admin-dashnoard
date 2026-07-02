import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MS_FORMS_AGENT = {
  name: "samson maingi karau",
  mobile: "254789457580",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function submitOne(
  service: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  registrationId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: registration, error: regError } = await service
    .from("customer_registrations")
    .select(
      "id, customer_name, airtel_number, alternate_number, email, preferred_package, units_required, installation_town, delivery_landmark, installation_location, visit_date, visit_time, ms_forms_response_id"
    )
    .eq("id", registrationId)
    .maybeSingle();

  if (regError || !registration) {
    return { ok: false, error: regError?.message ?? "Registration not found" };
  }
  if (registration.ms_forms_response_id) {
    return { ok: true };
  }

  const submitRes = await fetch(`${supabaseUrl}/functions/v1/submit-ms-forms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      customerData: {
        customerName: registration.customer_name,
        airtelNumber: registration.airtel_number,
        alternateNumber: registration.alternate_number ?? "",
        email: registration.email ?? "",
        preferredPackage: registration.preferred_package ?? "",
        unitsRequired: registration.units_required ?? 1,
        installationTown: registration.installation_town ?? "",
        deliveryLandmark: registration.delivery_landmark ?? "",
        installationLocation: registration.installation_location ?? "",
        visitDate: registration.visit_date ?? "",
        visitTime: registration.visit_time ?? "",
      },
      agentData: MS_FORMS_AGENT,
    }),
  });

  const payload = await submitRes.json().catch(() => ({}));
  if (!submitRes.ok || !payload?.success) {
    return {
      ok: false,
      error: String(
        payload?.error ?? payload?.message ?? `MS Forms failed (${submitRes.status})`
      ),
    };
  }

  const responseId = String(
    payload?.responseId ?? payload?.id ?? payload?.data?.responseId ?? ""
  );
  if (!responseId) {
    return { ok: false, error: "Missing response ID from MS Forms" };
  }

  const { error: updateError } = await service
    .from("customer_registrations")
    .update({
      ms_forms_response_id: responseId,
      ms_forms_submitted_at: new Date().toISOString(),
    })
    .eq("id", registrationId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }
  return { ok: true };
}

function isAuthorized(req: Request, serviceKey: string): boolean {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  const key = serviceKey.trim();
  if (bearer && bearer === key) return true;
  if (apikey && apikey === key) return true;
  const workerSecret = Deno.env.get("MS_FORMS_WORKER_SECRET")?.trim();
  if (workerSecret && bearer === workerSecret) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!isAuthorized(req, serviceKey)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(supabaseUrl, serviceKey);
    const { data: config } = await service
      .from("ms_forms_config")
      .select("submission_mode")
      .limit(1)
      .maybeSingle();

    if (config?.submission_mode !== "auto") {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "manual_mode" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json().catch(() => ({}));
    const webhookRecord = body.record as { id?: string } | undefined;
    const registrationId = String(
      body.registrationId ?? webhookRecord?.id ?? ""
    ).trim();

    const ids: string[] = [];

    if (registrationId) {
      ids.push(registrationId);
    } else {
      const { data: rows } = await service
        .from("customer_registrations")
        .select("id")
        .is("ms_forms_response_id", null)
        .order("created_at", { ascending: true })
        .limit(Number(body.limit) || 50);
      ids.push(...(rows ?? []).map((r) => r.id));
    }

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const id of ids) {
      const result = await submitOne(service, supabaseUrl, serviceKey, id);
      if (result.ok) succeeded++;
      else {
        failed++;
        if (result.error) errors.push(`${id}: ${result.error}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: ids.length,
        succeeded,
        failed,
        errors: errors.slice(0, 10),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Worker failed";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
