import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Body = {
  clientHandoffId?: string;
  customerName?: string;
  phoneNumber?: string;
  email?: string;
  preferredPackage?: string;
  unitsRequired?: number;
  installationTown?: string;
  landmark?: string;
};

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeKenyanPhone(value: unknown): string | null {
  let digits = text(value).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) digits = `254${digits}`;
  return /^254[17]\d{8}$/.test(digits) ? digits : null;
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const clientHandoffId = text(body.clientHandoffId);
    const customerName = text(body.customerName);
    const phone = normalizeKenyanPhone(body.phoneNumber);
    const email = text(body.email);
    const preferredPackage = text(body.preferredPackage).toLowerCase();
    const unitsRequired = Number(body.unitsRequired);
    const installationTown = text(body.installationTown);
    const landmark = text(body.landmark);

    if (!clientHandoffId || clientHandoffId.length < 8) {
      return new Response(
        JSON.stringify({ error: "clientHandoffId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const missing: string[] = [];
    if (!customerName) missing.push("customerName");
    if (!phone) missing.push("phoneNumber");
    if (!email) missing.push("email");
    if (!["standard", "premium"].includes(preferredPackage)) missing.push("preferredPackage");
    if (!Number.isInteger(unitsRequired) || unitsRequired < 1 || unitsRequired > 2) {
      missing.push("unitsRequired");
    }
    if (!installationTown) missing.push("installationTown");
    if (!landmark) missing.push("landmark");
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({ error: "Validation failed", fields: missing }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: modeRow, error: modeError } = await userClient.rpc(
      "get_my_registration_mode",
    );

    if (modeError) {
      console.error("get_my_registration_mode:", modeError.message);
      return new Response(
        JSON.stringify({ error: "Registration mode unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const mode = (modeRow as { mode?: string })?.mode ?? "legacy_wam";
    if (mode !== "airtel_connect") {
      return new Response(
        JSON.stringify({
          error: "Airtel Connect registration is not enabled for your county",
          mode,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: agent, error: agentError } = await admin
      .from("agents")
      .select("id, status, town")
      .eq("id", user.id)
      .maybeSingle();

    if (agentError || !agent) {
      return new Response(JSON.stringify({ error: "Agent profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (agent.status !== "approved") {
      return new Response(JSON.stringify({ error: "Agent not approved" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing } = await admin
      .from("customer_registrations")
      .select("id, airtel_connect_handoff_status")
      .eq("agent_id", user.id)
      .eq("client_handoff_id", clientHandoffId)
      .maybeSingle();

    if (existing?.id) {
      return new Response(
        JSON.stringify({
          success: true,
          registrationId: existing.id,
          idempotentReplay: true,
          handoffStatus: existing.airtel_connect_handoff_status,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: inserted, error: insertError } = await admin
      .from("customer_registrations")
      .insert({
        agent_id: user.id,
        customer_name: customerName,
        airtel_number: phone,
        email,
        preferred_package: preferredPackage,
        units_required: unitsRequired,
        installation_town: installationTown,
        installation_location: installationTown,
        delivery_landmark: landmark,
        registration_workflow: "airtel_connect",
        client_handoff_id: clientHandoffId,
        airtel_connect_handoff_status: "pending",
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: raced } = await admin
          .from("customer_registrations")
          .select("id, airtel_connect_handoff_status")
          .eq("agent_id", user.id)
          .eq("client_handoff_id", clientHandoffId)
          .maybeSingle();
        if (raced?.id) {
          return new Response(
            JSON.stringify({
              success: true,
              registrationId: raced.id,
              idempotentReplay: true,
              handoffStatus: raced.airtel_connect_handoff_status,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      console.error("insert customer_registrations:", insertError.message);
      return new Response(
        JSON.stringify({ error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        registrationId: inserted.id,
        idempotentReplay: false,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("submit-airtel-connect-registration:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
