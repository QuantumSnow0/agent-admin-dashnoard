"use client";

import { useState } from "react";
import { SendNotificationForm } from "@/components/notifications/send-notification-form";
import { ActiveHomeSpotlightsPanel } from "@/components/notifications/active-home-spotlights";

type AgentOption = {
  id: string;
  name: string | null;
  email: string | null;
};

export function SendNotificationClient({
  agents,
  initialAgentId,
}: {
  agents: AgentOption[];
  initialAgentId?: string | null;
}) {
  const [spotlightRefresh, setSpotlightRefresh] = useState(0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
        <SendNotificationForm
          agents={agents}
          initialAgentId={initialAgentId}
          onSent={() => setSpotlightRefresh((n) => n + 1)}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
        <ActiveHomeSpotlightsPanel
          agents={agents}
          refreshToken={spotlightRefresh}
        />
      </div>
    </div>
  );
}
