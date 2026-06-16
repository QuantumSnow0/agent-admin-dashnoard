import { createClient } from "@/lib/supabase/server";

export async function isSuperAdminUser(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();

  return agent?.is_super_admin === true;
}

export async function requireSuperAdmin(): Promise<{
  userId: string;
  email: string | undefined;
  name: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("NOT_AUTHENTICATED");
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("is_super_admin, name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (!agent?.is_super_admin) {
    throw new Error("SUPER_ADMIN_REQUIRED");
  }

  return {
    userId: user.id,
    email: agent.email ?? user.email,
    name: agent.name,
  };
}
