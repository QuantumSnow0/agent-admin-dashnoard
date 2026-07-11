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
};

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

  const responseIdString = String(responseId);
  const submittedAt = new Date().toISOString();

  const { error: updateError } = await service
    .from("customer_registrations")
    .update({
      ms_forms_response_id: responseIdString,
      ms_forms_submitted_at: submittedAt,
    })
    .eq("id", registrationId);

  if (updateError) {
    return {
      success: false,
      error: `Submitted to MS Forms but DB update failed: ${updateError.message}`,
    };
  }

  return { success: true, responseId: responseIdString };
}
