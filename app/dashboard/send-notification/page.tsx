import { requireDashboardAdmin } from "@/lib/utils/admin";
import { Bell } from "lucide-react";
import { SendNotificationClient } from "@/components/notifications/send-notification-client";

interface SendNotificationPageProps {
  searchParams: Promise<{ agentId?: string }>;
}

export default async function SendNotificationPage({
  searchParams,
}: SendNotificationPageProps) {
  const { supabase } = await requireDashboardAdmin();
  const params = await searchParams;
  const initialAgentId = params.agentId ?? null;

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
        Send a push notification or SMS to one agent, multiple agents, or all
        agents. Meetings and urgent items stay on Home until agents dismiss
        them, they expire, or you clear them below. SMS uses each agent&apos;s
        Airtel / Safaricom phone on file.
      </p>

      <SendNotificationClient
        agents={agents ?? []}
        initialAgentId={initialAgentId}
      />
    </div>
  );
}
