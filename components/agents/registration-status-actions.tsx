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
  CircleCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
export type RegistrationSource = "airtel" | "safaricom";

interface RegistrationStatusActionsProps {
  registration: {
    id: string;
    status: string;
    source: RegistrationSource;
  };
}

const SAFARICOM_STATUSES = [
  { value: "pending", label: "Pending", icon: Clock },
  { value: "installed", label: "Installed", icon: Package },
  { value: "rejected", label: "Rejected", icon: XCircle },
  { value: "duplicate", label: "Duplicate", icon: Copy },
  { value: "cancelled", label: "Cancelled", icon: Ban },
] as const;

const AIRTEL_STATUSES = [
  { value: "pending", label: "Pending", icon: Clock },
  { value: "installed", label: "Installed", icon: Package },
  { value: "approved", label: "Approved", icon: CircleCheck },
  { value: "denied", label: "Denied", icon: XCircle },
] as const;

export function RegistrationStatusActions({ registration }: RegistrationStatusActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<"approved" | "denied" | null>(null);
  const [amount, setAmount] = useState("");
  const [mpesaReference, setMpesaReference] = useState("");
  const [reason, setReason] = useState("");

  const statuses =
    registration.source === "airtel" ? AIRTEL_STATUSES : SAFARICOM_STATUSES;

  const submitDecision = async () => {
    if (!decision) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/registrations/${registration.id}/payment`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            decision === "approved"
              ? { decision, amountKes: Number(amount), mpesaReference }
              : { decision, reason }
          ),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Could not update status");
      }
      setDecision(null);
      setAmount("");
      setMpesaReference("");
      setReason("");
      router.refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Could not update status");
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (registration.source === "airtel" && (newStatus === "approved" || newStatus === "denied")) {
      setAmount("");
      setMpesaReference("");
      setReason("");
      setDecision(newStatus);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const table =
        registration.source === "safaricom" ? "safaricom_registrations" : "customer_registrations";
      const { error } = await supabase.from(table).update({ status: newStatus }).eq("id", registration.id);

      if (error) {
        console.error("Error updating registration status:", error);
        alert(`Failed to update status: ${error.message}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      alert("An error occurred while updating the registration");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={loading} className="h-8 w-8 p-0">
          <span className="sr-only">Change status</span>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Set status</DropdownMenuLabel>
        {statuses.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => handleStatusChange(value)}
            disabled={loading || registration.status === value}
            className={registration.status === value ? "bg-gray-50 font-medium" : ""}
          >
            <Icon className="mr-2 h-4 w-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={decision !== null} onOpenChange={(open) => { if (!open) setDecision(null); }}>
      <DialogContent className="sm:max-w-md">
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
                placeholder="Amount for this registration"
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
