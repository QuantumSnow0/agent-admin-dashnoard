import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Check if the current user is an admin
 * @returns Promise<boolean> - true if user is admin, false otherwise
 */
export async function isAdminUser(): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  return agent?.is_admin === true;
}

/**
 * Get admin status for a specific user ID
 * @param userId - The user ID to check
 * @returns Promise<boolean> - true if user is admin, false otherwise
 */
export async function isAdminUserById(userId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("agents")
    .select("is_admin")
    .eq("id", userId)
    .single();

  return agent?.is_admin === true;
}

/** One auth + admin lookup per request. Layout and pages share this. */
export const requireDashboardAdmin = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=not_authenticated");
  }

  const { data: admin } = await supabase
    .from("agents")
    .select("is_admin, name, email, status")
    .eq("id", user.id)
    .maybeSingle();

  if (!admin?.is_admin) {
    redirect("/login?error=admin_access_required");
  }

  return { user, admin, supabase };
});
