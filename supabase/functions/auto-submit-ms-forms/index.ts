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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const registrationId = String(body.registrationId ?? "").trim();
    if (!registrationId) {
      return new Response(
        JSON.stringify({ error: "registrationId is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
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
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
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
        JSON.stringify({
          success: true,
          skipped: true,
          reason: "manual_mode",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: registration, error: regError } = await service
      .from("customer_registrations")
      .select(
        "id, agent_id, customer_name, airtel_number, alternate_number, email, preferred_package, units_required, installation_town, delivery_landmark, installation_location, visit_date, visit_time, ms_forms_response_id"
      )
      .eq("id", registrationId)
      .maybeSingle();

    if (regError || !registration) {
      return new Response(
        JSON.stringify({ error: regError?.message ?? "Registration not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (registration.agent_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (registration.ms_forms_response_id) {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          responseId: registration.ms_forms_response_id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const customerData = {
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
    };

    const submitRes = await fetch(
      `${supabaseUrl}/functions/v1/submit-ms-forms`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          customerData,
          agentData: MS_FORMS_AGENT,
        }),
      }
    );

    const payload = await submitRes.json().catch(() => ({}));

    if (!submitRes.ok || !payload?.success) {
      const message =
        payload?.error ??
        payload?.message ??
        `MS Forms request failed (${submitRes.status})`;
      return new Response(JSON.stringify({ success: false, error: String(message) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const responseId = String(
      payload?.responseId ?? payload?.id ?? payload?.data?.responseId ?? ""
    );
    if (!responseId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing response ID from MS Forms" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const submittedAt = new Date().toISOString();
    const { error: updateError } = await service
      .from("customer_registrations")
      .update({
        ms_forms_response_id: responseId,
        ms_forms_submitted_at: submittedAt,
      })
      .eq("id", registrationId);

    if (updateError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Submitted to MS Forms but DB update failed: ${updateError.message}`,
          responseId,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, responseId, submittedAt }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Auto-submit failed";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
