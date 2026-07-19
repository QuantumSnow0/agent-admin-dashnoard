import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleCorsPreflight, jsonResponse } from "../_shared/dispatch/cors.ts";

const MS_FORMS_AGENT = {
  name: "samson maingi karau",
  mobile: "254789457580",
};

type AgentSubmissionSmsOutcome = "success" | "failure";

type CustomerData = {
  customerName?: unknown;
  airtelNumber?: unknown;
  alternateNumber?: unknown;
  email?: unknown;
  preferredPackage?: unknown;
  unitsRequired?: unknown;
  installationTown?: unknown;
  deliveryLandmark?: unknown;
  installationLocation?: unknown;
  visitDate?: unknown;
  visitTime?: unknown;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeKenyanPhone(value: unknown): string | null {
  let digits = text(value).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) digits = `254${digits}`;
  return /^254[17]\d{8}$/.test(digits) ? digits : null;
}

async function sendAgentSubmissionSms(input: {
  phone: string | null;
  customerName: string;
  outcome: AgentSubmissionSmsOutcome;
}): Promise<boolean> {
  if (!input.phone) {
    console.error("complete-lead-registration SMS: agent has no valid phone");
    return false;
  }

  const onfonApiKey = Deno.env.get("ONFON_API_KEY");
  const onfonClientId = Deno.env.get("ONFON_CLIENT_ID");
  const onfonAccessKey = Deno.env.get("ONFON_ACCESS_KEY");
  const onfonSenderId = Deno.env.get("ONFON_SENDER_ID");
  if (!onfonApiKey || !onfonClientId || !onfonAccessKey || !onfonSenderId) {
    console.error("complete-lead-registration SMS: missing Onfon configuration");
    return false;
  }

  const message =
    input.outcome === "success"
      ? `Order for ${input.customerName} was sent to Airtel successfully. Please ask the customer whether Airtel has called. If not, call 0733100500 for follow-up.`
      : `Order for ${input.customerName} did not reach Airtel. Please call 0700776994 for assistance before trying again.`;

  try {
    const response = await fetch(
      "https://api.onfonmedia.co.ke/v1/sms/SendBulkSMS",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          AccessKey: onfonAccessKey,
        },
        body: JSON.stringify({
          SenderId: onfonSenderId,
          IsUnicode: false,
          IsFlash: false,
          MessageParameters: [{ Number: input.phone, Text: message }],
          ApiKey: onfonApiKey,
          ClientId: onfonClientId,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      ErrorCode?: unknown;
      ErrorDescription?: unknown;
    };
    const errorCode = Number(payload.ErrorCode);
    const accepted =
      response.ok && Number.isFinite(errorCode) && errorCode === 0;

    if (!accepted) {
      console.error(
        "complete-lead-registration SMS rejected:",
        response.status,
        Number.isFinite(errorCode) ? errorCode : "invalid_response",
      );
    }
    return accepted;
  } catch (error: unknown) {
    console.error(
      "complete-lead-registration SMS unavailable:",
      error instanceof Error ? error.name : "unknown",
    );
    return false;
  }
}

function validateCustomerData(input: CustomerData): string | null {
  const required = [
    ["customerName", input.customerName],
    ["airtelNumber", input.airtelNumber],
    ["alternateNumber", input.alternateNumber],
    ["email", input.email],
    ["installationTown", input.installationTown],
    ["deliveryLandmark", input.deliveryLandmark],
    ["installationLocation", input.installationLocation],
    ["visitDate", input.visitDate],
    ["visitTime", input.visitTime],
  ] as const;

  const missing = required.find(([, value]) => !text(value));
  if (missing) return `${missing[0]} is required`;
  if (!["standard", "premium"].includes(text(input.preferredPackage))) {
    return "preferredPackage must be standard or premium";
  }
  const units = Number(input.unitsRequired);
  if (!Number.isInteger(units) || units < 1 || units > 2) {
    return "unitsRequired must be 1 or 2";
  }
  return null;
}

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
    const body = (await req.json().catch(() => ({}))) as {
      leadId?: unknown;
      customerData?: CustomerData;
    };
    const leadId = text(body.leadId);
    const customerData = body.customerData ?? {};
    const validationError = validateCustomerData(customerData);

    if (!leadId) {
      return jsonResponse({ error: "leadId is required" }, 400);
    }
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error("complete-lead-registration: missing server configuration");
      return jsonResponse({ error: "Registration service is not configured" }, 500);
    }

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
    const { data: lead, error: leadError } = await service
      .from("inbound_leads")
      .select(
        "id, product, status, assigned_agent_id, contact_verified_at, contact_verified_phone, registration_id, metadata",
      )
      .eq("id", leadId)
      .maybeSingle();

    if (leadError || !lead) {
      return jsonResponse({ error: "Lead not found" }, 404);
    }
    if (lead.assigned_agent_id !== user.id) {
      return jsonResponse({ error: "Not your lead" }, 403);
    }
    if (lead.product !== "airtel") {
      return jsonResponse({ error: "This registration flow is Airtel-only" }, 400);
    }
    if (!lead.contact_verified_at) {
      return jsonResponse(
        { error: "Verify customer contact before submitting registration" },
        409,
      );
    }
    if (
      !lead.contact_verified_phone ||
      normalizeKenyanPhone(customerData.airtelNumber) !== lead.contact_verified_phone
    ) {
      return jsonResponse(
        { error: "The registration phone must match the verified customer phone" },
        409,
      );
    }
    if (["pending_install", "installed"].includes(lead.status)) {
      return jsonResponse({ error: "This lead is already past registration" }, 409);
    }

    const { data: agent } = await service
      .from("agents")
      .select("airtel_phone, safaricom_phone")
      .eq("id", user.id)
      .maybeSingle();
    const agentPhone =
      normalizeKenyanPhone(agent?.airtel_phone) ??
      normalizeKenyanPhone(agent?.safaricom_phone);

    let registration: {
      id: string;
      agent_id: string;
      ms_forms_response_id: string | null;
    } | null = null;

    if (lead.registration_id) {
      const { data: existing, error: existingError } = await service
        .from("customer_registrations")
        .select("id, agent_id, ms_forms_response_id")
        .eq("id", lead.registration_id)
        .eq("inbound_lead_id", leadId)
        .maybeSingle();

      if (existingError) {
        return jsonResponse({ error: "Could not load existing registration" }, 500);
      }
      registration = existing;
    } else {
      const { data: existing } = await service
        .from("customer_registrations")
        .select("id, agent_id, ms_forms_response_id")
        .eq("inbound_lead_id", leadId)
        .maybeSingle();
      registration = existing;
    }

    const registrationValues = {
      agent_id: user.id,
      customer_name: text(customerData.customerName),
      airtel_number: text(customerData.airtelNumber),
      alternate_number: text(customerData.alternateNumber),
      email: text(customerData.email),
      preferred_package: text(customerData.preferredPackage),
      units_required: Number(customerData.unitsRequired),
      installation_town: text(customerData.installationTown),
      delivery_landmark: text(customerData.deliveryLandmark),
      installation_location: text(customerData.installationLocation),
      visit_date: text(customerData.visitDate),
      visit_time: text(customerData.visitTime),
      status: "pending",
      inbound_lead_id: leadId,
      commission_exempt: true,
    };

    if (!registration) {
      const { data: inserted, error: insertError } = await service
        .from("customer_registrations")
        .insert(registrationValues)
        .select("id, agent_id, ms_forms_response_id")
        .single();

      if (insertError || !inserted) {
        console.error("complete-lead-registration insert:", insertError?.message);
        return jsonResponse({ error: "Could not save registration" }, 500);
      }
      registration = inserted;

      const { error: linkError } = await service
        .from("inbound_leads")
        .update({ registration_id: registration.id })
        .eq("id", leadId)
        .eq("assigned_agent_id", user.id);

      if (linkError) {
        console.error("complete-lead-registration link:", linkError.message);
        return jsonResponse({ error: "Could not link registration to lead" }, 500);
      }
    } else {
      if (registration.agent_id !== user.id) {
        return jsonResponse({ error: "Registration belongs to another agent" }, 403);
      }

      if (!registration.ms_forms_response_id) {
        const { error: updateError } = await service
          .from("customer_registrations")
          .update(registrationValues)
          .eq("id", registration.id)
          .eq("agent_id", user.id);

        if (updateError) {
          return jsonResponse({ error: "Could not update registration" }, 500);
        }
      }
    }

    if (registration.ms_forms_response_id) {
      const completedAt = new Date().toISOString();
      await service
        .from("inbound_leads")
        .update({
          registration_id: registration.id,
          status: "kyc_completed",
          kyc_completed_at: completedAt,
          kyc_outcome: "completed",
        })
        .eq("id", leadId)
        .eq("assigned_agent_id", user.id);

      await sendAgentSubmissionSms({
        phone: agentPhone,
        customerName: registrationValues.customer_name,
        outcome: "success",
      });

      return jsonResponse({
        success: true,
        registrationId: registration.id,
        responseId: registration.ms_forms_response_id,
        status: "kyc_completed",
        idempotent: true,
      });
    }

    // Lead registrations always submit now, regardless of the global manual/auto mode.
    let submitResponse: Response;
    try {
      submitResponse = await fetch(
        `${supabaseUrl}/functions/v1/submit-ms-forms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            customerData: {
              customerName: registrationValues.customer_name,
              airtelNumber: registrationValues.airtel_number,
              alternateNumber: registrationValues.alternate_number,
              email: registrationValues.email,
              preferredPackage: registrationValues.preferred_package,
              unitsRequired: registrationValues.units_required,
              installationTown: registrationValues.installation_town,
              deliveryLandmark: registrationValues.delivery_landmark,
              installationLocation: registrationValues.installation_location,
              visitDate: registrationValues.visit_date,
              visitTime: registrationValues.visit_time,
            },
            agentData: MS_FORMS_AGENT,
          }),
        },
      );
    } catch (submitError: unknown) {
      console.error(
        "complete-lead-registration carrier unavailable:",
        submitError instanceof Error ? submitError.name : "unknown",
      );
      await sendAgentSubmissionSms({
        phone: agentPhone,
        customerName: registrationValues.customer_name,
        outcome: "failure",
      });
      return jsonResponse(
        {
          error: "Registration was saved, but Airtel could not be reached. Try again.",
          registrationId: registration.id,
          retryable: true,
        },
        502,
      );
    }

    const submitPayload = (await submitResponse.json().catch(() => ({}))) as {
      success?: unknown;
      responseId?: unknown;
      id?: unknown;
      error?: unknown;
      message?: unknown;
      data?: { responseId?: unknown };
    };

    if (!submitResponse.ok || !submitPayload.success) {
      const providerError = text(submitPayload.error || submitPayload.message);
      console.error(
        "complete-lead-registration MS Forms:",
        providerError || submitResponse.status,
      );
      await sendAgentSubmissionSms({
        phone: agentPhone,
        customerName: registrationValues.customer_name,
        outcome: "failure",
      });
      return jsonResponse(
        {
          error:
            providerError ||
            "Registration was saved, but final submission failed. Try again.",
          registrationId: registration.id,
          retryable: true,
        },
        502,
      );
    }

    const responseId = text(
      submitPayload.responseId ||
        submitPayload.id ||
        submitPayload.data?.responseId,
    );
    if (!responseId) {
      await sendAgentSubmissionSms({
        phone: agentPhone,
        customerName: registrationValues.customer_name,
        outcome: "failure",
      });
      return jsonResponse(
        {
          error: "The carrier workflow did not confirm the submission. Try again.",
          registrationId: registration.id,
          retryable: true,
        },
        502,
      );
    }

    const submittedAt = new Date().toISOString();
    const { error: registrationUpdateError } = await service
      .from("customer_registrations")
      .update({
        ms_forms_response_id: responseId,
        ms_forms_submitted_at: submittedAt,
      })
      .eq("id", registration.id);

    if (registrationUpdateError) {
      console.error(
        "complete-lead-registration response save:",
        registrationUpdateError.message,
      );
      return jsonResponse(
        {
          error: "Registration submitted, but confirmation could not be saved",
          registrationId: registration.id,
        },
        500,
      );
    }

    const previousMetadata =
      lead.metadata && typeof lead.metadata === "object"
        ? (lead.metadata as Record<string, unknown>)
        : {};
    const { error: leadUpdateError } = await service
      .from("inbound_leads")
      .update({
        registration_id: registration.id,
        status: "kyc_completed",
        kyc_completed_at: submittedAt,
        kyc_outcome: "completed",
        metadata: {
          ...previousMetadata,
          msForms: {
            submittedAt,
            responseId,
          },
        },
      })
      .eq("id", leadId)
      .eq("assigned_agent_id", user.id);

    if (leadUpdateError) {
      console.error("complete-lead-registration lead completion:", leadUpdateError.message);
      return jsonResponse(
        {
          error: "Registration submitted, but lead status could not be updated",
          registrationId: registration.id,
          responseId,
        },
        500,
      );
    }

    await sendAgentSubmissionSms({
      phone: agentPhone,
      customerName: registrationValues.customer_name,
      outcome: "success",
    });

    return jsonResponse({
      success: true,
      registrationId: registration.id,
      responseId,
      status: "kyc_completed",
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Registration submission failed";
    console.error("complete-lead-registration:", message);
    return jsonResponse({ error: "Could not submit registration" }, 500);
  }
});
