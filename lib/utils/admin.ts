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
