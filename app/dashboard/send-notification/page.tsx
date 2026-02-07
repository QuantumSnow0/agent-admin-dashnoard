import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import { SendNotificationForm } from "@/components/notifications/send-notification-form";

interface SendNotificationPageProps {
  searchParams: Promise<{ agentId?: string }>;
}

export default async function SendNotificationPage({ searchParams }: SendNotificationPageProps) {
  const supabase = await createClient();
  const params = await searchParams;
  const initialAgentId = params.agentId ?? null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=not_authenticated");
  }

  const { data: currentUser } = await supabase
    .from("agents")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!currentUser?.is_admin) {
    redirect("/login?error=admin_access_required");
  }

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, email")
    .order("name", { ascending: true, nullsFirst: false });

  return (
    <div className="space-y-6 -ml-2 -mt-6">
      <div className="flex items-center gap-2">
        <Bell className="h-6 w-6 text-gray-700" />
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          Send notification
        </h1>
      </div>

      <p className="text-sm text-gray-600 max-w-xl">
        Send a custom notification to one agent, multiple agents, or all agents. They will see it in the app and may receive a push notification if enabled.
      </p>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 max-w-2xl">
        <SendNotificationForm agents={agents ?? []} initialAgentId={initialAgentId} />
      </div>
    </div>
  );
}
