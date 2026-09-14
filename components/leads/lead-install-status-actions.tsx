"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical,
  Clock,
  Package,
  XCircle,
  Copy,
  Ban,
} from "lucide-react";
import { resolveLeadInstallDisplayKes } from "@/lib/lead-install-commission";
import type { LeadPackageFees } from "@/lib/lead-install-commission";
import { formatLeadStatusLabel, type AdminInboundLeadRow } from "@/lib/admin-leads";

type LeadInstallStatusActionsProps = {
  lead: {
    id: string;
    status: string;
    source?: string | null;
    submitted_by_agent_id?: string | null;
    preferred_package?: string | null;
    plan_label?: string | null;
    airtel_sr_number?: string | null;
    safaricom_imei?: string | null;
    product?: string;
  };
  /** When set, called after success instead of router.refresh() */
  onUpdated?: (lead: AdminInboundLeadRow) => void;
  /** Stop row click-through when used in a table row */
  stopPropagation?: boolean;
  receiverFees?: LeadPackageFees;
  /** @deprecated use receiverFees */
  receiverCommissionKes?: number;
};

export function LeadInstallStatusActions({
  lead,
  onUpdated,
  stopPropagation = false,
  receiverFees,
  receiverCommissionKes = 0,
}: LeadInstallStatusActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const earn = resolveLeadInstallDisplayKes({
    source: lead.source,
    submitted_by_agent_id: lead.submitted_by_agent_id,
    preferredPackage: lead.plan_label ?? lead.preferred_package,
    receiverFees: receiverFees ?? {
      standard: receiverCommissionKes,
      premium: receiverCommissionKes,
    },
  });

  const installStatuses = [
    { value: "pending_install", label: "Pending", icon: Clock },
    {
      value: "installed",
      label:
        earn != null
          ? `Installed (KSh ${earn.toLocaleString()})`
          : "Installed",
      icon: Package,
    },
    { value: "rejected", label: "Rejected", icon: XCircle },
    { value: "duplicate", label: "Duplicate", icon: Copy },
    { value: "cancelled", label: "Cancelled", icon: Ban },
  ] as const;

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === lead.status) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = (await res.json()) as {
        error?: string;
        lead?: AdminInboundLeadRow;
      };
      if (!res.ok) {
        alert(data.error ?? "Failed to update status");
        return;
      }
      if (onUpdated && data.lead) {
        onUpdated(data.lead);
      } else {
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      alert("An error occurred while updating status");
    } finally {
      setLoading(false);
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
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
        >
          <span className="sr-only">Change status</span>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      >
        <DropdownMenuLabel>Set status</DropdownMenuLabel>
        {installStatuses.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => void handleStatusChange(value)}
            disabled={loading || lead.status === value}
            className={lead.status === value ? "bg-gray-50 font-medium" : ""}
          >
            <Icon className="mr-2 h-4 w-4" />
            {label}
          </DropdownMenuItem>
        ))}
        {!installStatuses.some((s) => s.value === lead.status) ? (
          <DropdownMenuItem disabled className="text-xs text-amber-700">
            Currently “{formatLeadStatusLabel(lead.status)}” — pick a new status
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
