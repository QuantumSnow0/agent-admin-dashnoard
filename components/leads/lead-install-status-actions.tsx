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
  XCircle,
  Copy,
  Ban,
  CircleCheck,
} from "lucide-react";
import type { LeadPackageFees } from "@/lib/lead-install-commission";
import { formatLeadStatusLabel, type AdminInboundLeadRow } from "@/lib/admin-leads";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  void receiverFees;
  void receiverCommissionKes;
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  const [amount, setAmount] = useState("");
  const [mpesaReference, setMpesaReference] = useState("");
  const [reason, setReason] = useState("");

  const installStatuses = [
    { value: "pending_install", label: "Pending", icon: Clock },
    { value: "approved", label: "Approved", icon: CircleCheck },
    { value: "denied", label: "Denied", icon: XCircle },
    { value: "rejected", label: "Rejected", icon: XCircle },
    { value: "duplicate", label: "Duplicate", icon: Copy },
    { value: "cancelled", label: "Cancelled", icon: Ban },
  ] as const;

  const submitDecision = async () => {
    if (!decision) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          decision === "approved"
            ? { status: "approved", amountKes: Number(amount), mpesaReference }
            : { status: "denied", reason }
        ),
      });
      const data = (await res.json()) as {
        error?: string;
        lead?: AdminInboundLeadRow;
      };
      if (!res.ok) {
        alert(data.error ?? "Failed to update status");
        return;
      }
      setDecision(null);
      setAmount("");
      setMpesaReference("");
      setReason("");
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

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === lead.status) return;
    if (newStatus === "approved" || newStatus === "denied") {
      setAmount("");
      setMpesaReference("");
      setReason("");
      setDecision(newStatus);
      return;
    }
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
    <>
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
    <Dialog open={decision !== null} onOpenChange={(open) => { if (!open) setDecision(null); }}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>
            {decision === "approved" ? "Approve payment" : "Deny payment"}
          </DialogTitle>
        </DialogHeader>
        {decision === "approved" ? (
          <div className="space-y-3">
            <label className="block text-sm text-gray-700">
              Amount (KSh)
              <input
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="Amount for this lead"
              />
            </label>
            <label className="block text-sm text-gray-700">
              M-Pesa reference
              <input
                type="text"
                value={mpesaReference}
                onChange={(e) => setMpesaReference(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase"
                placeholder="M-Pesa code"
              />
            </label>
          </div>
        ) : (
          <label className="block text-sm text-gray-700">
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              rows={3}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Why this will not be paid"
            />
          </label>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setDecision(null)} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submitDecision()} disabled={loading}>
            {loading ? "Saving…" : decision === "approved" ? "Approve" : "Deny"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
