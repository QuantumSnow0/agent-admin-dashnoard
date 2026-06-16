export type SuperAdminAgentDetail = {
  id: string;
  name: string | null;
  email: string | null;
  airtel_phone: string | null;
  safaricom_phone: string | null;
  town: string | null;
  area: string | null;
  status: string | null;
  created_at: string | null;
  total_earnings: number | null;
  available_balance: number | null;
};

export type SuperAdminRegistrationDetail = {
  id: string;
  agent_id: string;
  customer_name: string;
  airtel_number: string | null;
  alternate_number: string | null;
  email: string | null;
  preferred_package: string | null;
  units_required: number | null;
  installation_town: string | null;
  delivery_landmark: string | null;
  installation_location: string | null;
  visit_date: string | null;
  visit_time: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  ms_forms_response_id: string | null;
  ms_forms_submitted_at: string | null;
  agent: SuperAdminAgentDetail | null;
};
