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
import { MoreVertical, CheckCircle2, XCircle, Ban, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface AgentActionsProps {
  agent: {
    id: string;
    name?: string;
    email: string;
    status: string;
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

      const { error } = await supabase
        .from("agents")
        .update({ status: newStatus })
        .eq("id", agent.id);

      if (error) {
        console.error("Error updating agent status:", error);
        alert(`Failed to update status: ${error.message}`);
      } else {
        // Refresh the page to show updated status
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
          </DropdownMenuItem>
        );
      default:
        return null;
    }
  };

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
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {getStatusActions()}
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
