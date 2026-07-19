import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function requireAdminApi() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }

  const { data: admin } = await supabase
    .from("agents")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!admin?.is_admin) {
    return {
      error: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }

  return { user, supabase };
}
