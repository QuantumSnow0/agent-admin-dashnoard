import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AgentsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=not_authenticated");
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("is_admin, name, email")
    .eq("id", user.id)
    .single();

  if (!agent || !agent.is_admin) {
    redirect("/login?error=admin_access_required");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          Agents
        </h1>
      </div>
    </div>
  );
}
