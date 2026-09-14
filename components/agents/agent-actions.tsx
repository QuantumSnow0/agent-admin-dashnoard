"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical,
  CheckCircle2,
  XCircle,
  Ban,
  User,
  Smartphone,
  Undo2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface AgentActionsProps {
  agent: {
    id: string;
    name?: string;
    email: string;
    status: string;
    airtel_connect_opened?: boolean;
  };
}

export function AgentActions({ agent }: AgentActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleStatusChange = async (newStatus: string) => {
    setActionLoading(newStatus);
    setLoading(true);

    try {
      const supabase = createClient();

      // Approving the account does NOT enable website leads.
      // lead_dispatch_scope stays / resets to none until admin sets it.
      const updatePayload: { status: string; lead_dispatch_scope?: string } = {
        status: newStatus,
      };
      if (newStatus === "approved") {
        updatePayload.lead_dispatch_scope = "none";
      }

      const { error } = await supabase
        .from("agents")
        .update(updatePayload)
        .eq("id", agent.id);

      if (error) {
        console.error("Error updating agent status:", error);
        alert(`Failed to update status: ${error.message}`);
      } else {
        if (newStatus === "approved") {
          alert(
            "Agent approved. Enable inbound leads separately under Lead dispatch (Airtel / Safaricom / both).",
          );
        }
        router.refresh();
      }
    } catch (error) {
      console.error("Error updating agent status:", error);
      alert("An error occurred while updating the agent status");
    } finally {
      setLoading(false);
      setActionLoading(null);
    }
  };

  const handleAirtelConnect = async (opened: boolean) => {
    setActionLoading(opened ? "connect_open" : "connect_clear");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/agents/${agent.id}/airtel-connect`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opened, notify: opened }),
      });
      const data = (await res.json()) as {
        error?: string;
        notified?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Update failed");
      }
      if (opened) {
        alert(
          data.notified
            ? "Marked as Connect opened. Agent was notified with setup steps."
            : "Marked as Connect opened. Notification could not be sent — check later.",
        );
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not update Airtel Connect status");
    } finally {
      setLoading(false);
      setActionLoading(null);
    }
  };

  const getStatusActions = () => {
    switch (agent.status) {
      case "pending":
        return (
          <>
            <DropdownMenuItem
              onClick={() => handleStatusChange("approved")}
              disabled={loading}
              className="text-green-700 focus:text-green-700"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Approve Agent
              <span className="ml-1 text-xs text-gray-500">(leads stay off)</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleStatusChange("rejected")}
              disabled={loading}
              className="text-gray-700 focus:text-gray-700"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Reject Application
            </DropdownMenuItem>
          </>
        );
      case "approved":
        return (
          <>
            <DropdownMenuItem
              onClick={() => handleStatusChange("banned")}
              disabled={loading}
              className="text-red-700 focus:text-red-700"
            >
              <Ban className="mr-2 h-4 w-4" />
              Ban Agent
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleStatusChange("pending")}
              disabled={loading}
              className="text-orange-700 focus:text-orange-700"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Set to Pending
            </DropdownMenuItem>
          </>
        );
      case "banned":
        return (
          <DropdownMenuItem
            onClick={() => handleStatusChange("approved")}
            disabled={loading}
            className="text-green-700 focus:text-green-700"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Unban Agent
            <span className="ml-1 text-xs text-gray-500">(re-enable leads after)</span>
          </DropdownMenuItem>
        );
      case "rejected":
        return (
          <DropdownMenuItem
            onClick={() => handleStatusChange("approved")}
            disabled={loading}
            className="text-green-700 focus:text-green-700"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Approve Agent
            <span className="ml-1 text-xs text-gray-500">(leads stay off)</span>
          </DropdownMenuItem>
        );
      default:
        return null;
    }
  };

  const connectOpened = agent.airtel_connect_opened === true;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          className="h-8 w-8 p-0"
        >
          <span className="sr-only">Open menu</span>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {getStatusActions()}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-gray-500">
          Airtel Connect app
        </DropdownMenuLabel>
        {connectOpened ? (
          <DropdownMenuItem
            onClick={() => void handleAirtelConnect(false)}
            disabled={loading}
            className="text-gray-700 focus:text-gray-700"
          >
            <Undo2 className="mr-2 h-4 w-4" />
            {actionLoading === "connect_clear"
              ? "Clearing…"
              : "Clear Connect opened"}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => void handleAirtelConnect(true)}
            disabled={loading}
            className="text-red-700 focus:text-red-700"
          >
            <Smartphone className="mr-2 h-4 w-4" />
            {actionLoading === "connect_open"
              ? "Saving…"
              : "Mark Connect opened + notify"}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/agents/${agent.id}`} className="flex cursor-pointer items-center text-blue-700 focus:text-blue-700">
            <User className="mr-2 h-4 w-4" />
            View Profile
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
