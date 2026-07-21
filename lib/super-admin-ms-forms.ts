import { createServiceClient } from "@/lib/supabase/service";

/** Enterprise agent details sent to Microsoft Forms (matches agent app). */
const MS_FORMS_AGENT = {
  name: "samson maingi karau",
  mobile: "254789457580",
};

export type MSFormsSubmitResult = {
  success: boolean;
  responseId?: string;
  error?: string;
  alreadySubmitted?: boolean;
};

async function postCustomerToMSForms(customerData: {
  customerName: string;
  airtelNumber: string;
  alternateNumber: string;
  email: string;
  preferredPackage: string;
  unitsRequired: number;
  installationTown: string;
  deliveryLandmark: string;
  installationLocation: string;
  visitDate: string;
  visitTime: string;
}): Promise<MSFormsSubmitResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const response = await fetch(`${supabaseUrl}/functions/v1/submit-ms-forms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      customerData,
      agentData: MS_FORMS_AGENT,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      payload?.error ??
      payload?.message ??
      `MS Forms request failed (${response.status})`;
    return { success: false, error: String(message) };
  }

  const responseId =
    payload?.responseId ??
    payload?.data?.responseId ??
    payload?.id ??
    payload?.response?.id;

  if (!payload?.success && !responseId) {
    return {
      success: false,
      error: payload?.error ?? "Microsoft Forms did not return a response ID",
    };
  }

  if (!responseId) {
    return { success: false, error: "Missing response ID from Microsoft Forms" };
  }

  return { success: true, responseId: String(responseId) };
}

export async function submitRegistrationToMSForms(
  registrationId: string
): Promise<MSFormsSubmitResult> {
  const service = createServiceClient();

  const { data: registration, error: fetchError } = await service
    .from("customer_registrations")
    .select(
      "id, agent_id, customer_name, airtel_number, alternate_number, email, preferred_package, units_required, installation_town, delivery_landmark, installation_location, visit_date, visit_time, ms_forms_response_id"
    )
    .eq("id", registrationId)
    .maybeSingle();

  if (fetchError || !registration) {
    return { success: false, error: fetchError?.message ?? "Registration not found" };
  }

  if (registration.ms_forms_response_id) {
    return {
      success: true,
      responseId: registration.ms_forms_response_id,
      alreadySubmitted: true,
    };
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

  const result = await postCustomerToMSForms(customerData);
  if (!result.success || !result.responseId) {
    return result;
  }

  const submittedAt = new Date().toISOString();

  const { error: updateError } = await service
    .from("customer_registrations")
    .update({
      ms_forms_response_id: result.responseId,
      ms_forms_submitted_at: submittedAt,
    })
    .eq("id", registrationId);

  if (updateError) {
    return {
      success: false,
      error: `Submitted to MS Forms but DB update failed: ${updateError.message}`,
    };
  }

  return { success: true, responseId: result.responseId };
}

/**
 * Submit an inbound lead to Airtel Microsoft Forms using lead fields
 * (works whether or not a customer_registrations row exists).
 */
export async function submitInboundLeadToMSForms(
  leadId: string
): Promise<MSFormsSubmitResult> {
  const service = createServiceClient();

  const { data: lead, error: fetchError } = await service
    .from("inbound_leads")
    .select(
      "id, product, customer_name, primary_phone, alternate_phone, email, preferred_package, plan_label, installation_town, installation_area, delivery_landmark, visit_date, visit_time, ms_forms_response_id, registration_id"
    )
    .eq("id", leadId)
    .maybeSingle();

  if (fetchError || !lead) {
    return { success: false, error: fetchError?.message ?? "Lead not found" };
  }

  if (lead.product !== "airtel") {
    return { success: false, error: "Only Airtel leads can be submitted to MS Forms" };
  }

  if (lead.ms_forms_response_id) {
    return {
      success: true,
      responseId: lead.ms_forms_response_id,
      alreadySubmitted: true,
    };
  }

  // Prefer linked registration when present (richer field set).
  if (lead.registration_id) {
    const regResult = await submitRegistrationToMSForms(lead.registration_id);
    if (regResult.success && regResult.responseId) {
      const submittedAt = new Date().toISOString();
      await service
        .from("inbound_leads")
        .update({
          ms_forms_response_id: regResult.responseId,
          ms_forms_submitted_at: submittedAt,
        })
        .eq("id", leadId);
    }
    return regResult;
  }

  const town = lead.installation_town ?? "";
  const landmark = lead.delivery_landmark ?? "";
  const area = lead.installation_area ?? "";
  const installationLocation =
    area.trim() ||
    (town && landmark ? `${town} - ${landmark}` : landmark || town);

  const customerData = {
    customerName: lead.customer_name,
    airtelNumber: lead.primary_phone,
    alternateNumber: lead.alternate_phone ?? "",
    email: lead.email ?? "",
    preferredPackage: lead.plan_label ?? lead.preferred_package ?? "",
    unitsRequired: 1,
    installationTown: town,
    deliveryLandmark: landmark,
    installationLocation,
    visitDate: lead.visit_date ?? "",
    visitTime: lead.visit_time ?? "",
  };

  const result = await postCustomerToMSForms(customerData);
  if (!result.success || !result.responseId) {
    return result;
  }

  const submittedAt = new Date().toISOString();
  const { error: updateError } = await service
    .from("inbound_leads")
    .update({
      ms_forms_response_id: result.responseId,
      ms_forms_submitted_at: submittedAt,
    })
    .eq("id", leadId);

  if (updateError) {
    return {
      success: false,
      error: `Submitted to MS Forms but DB update failed: ${updateError.message}`,
    };
  }

  return { success: true, responseId: result.responseId };
}
