import type { SupabaseClient } from "@supabase/supabase-js";

export type MSFormsSubmissionMode = "auto" | "manual";

export async function fetchMSFormsSubmissionMode(
  supabase: SupabaseClient
): Promise<MSFormsSubmissionMode> {
  const { data, error } = await supabase
    .from("ms_forms_config")
    .select("submission_mode")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("ms_forms_config unavailable, defaulting to manual:", error.message);
    return "manual";
  }

  return data?.submission_mode === "auto" ? "auto" : "manual";
}

export async function updateMSFormsSubmissionMode(
  supabase: SupabaseClient,
  mode: MSFormsSubmissionMode
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing, error: readError } = await supabase
    .from("ms_forms_config")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (readError) {
    return { ok: false, error: readError.message };
  }

  if (existing?.id) {
    const { error } = await supabase
      .from("ms_forms_config")
      .update({ submission_mode: mode, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await supabase
    .from("ms_forms_config")
    .insert({ submission_mode: mode });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
