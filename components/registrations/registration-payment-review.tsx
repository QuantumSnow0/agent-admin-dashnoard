"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { AdminRegistrationRow } from "@/lib/admin-registrations";

type Props = {
  registration: AdminRegistrationRow;
};

export function RegistrationPaymentReview({ registration }: Props) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [mpesaReference, setMpesaReference] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState<"approved" | "denied" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (registration.source !== "airtel" || registration.status !== "installed") {
    return null;
  }

  const submit = async (decision: "approved" | "denied") => {
    setSaving(decision);
    setMessage(null);
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
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Could not save");
      }
      setMessage(decision === "approved" ? "Payment approved." : "Payment denied.");
      router.refresh();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/70 p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-sky-900">
        Confirm payment
      </p>
      <p className="mt-1 text-sm text-sky-900">
        The Order ID is logged, so this is installed on our side. Enter the
        amount to approve payment, or deny it with a reason.
      </p>

      <div className="mt-3">
        <Label htmlFor="payment-amount" className="text-xs text-gray-600">
          Amount (KSh)
        </Label>
        <input
          id="payment-amount"
          type="number"
          min={1}
          step={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          placeholder="Amount for this registration"
        />
        <Label htmlFor="mpesa-reference" className="mt-3 text-xs text-gray-600">
          M-Pesa reference
        </Label>
        <input
          id="mpesa-reference"
          type="text"
          value={mpesaReference}
          onChange={(e) => setMpesaReference(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm uppercase"
          placeholder="M-Pesa code"
        />
      </div>
      <Button
        type="button"
        className="mt-3 bg-emerald-700 hover:bg-emerald-800"
        disabled={saving !== null}
        onClick={() => void submit("approved")}
      >
        {saving === "approved" ? "Approving…" : "Approve payment"}
      </Button>

      <div className="mt-4">
        <Label htmlFor="denial-reason" className="text-xs text-gray-600">
          Reason for denial
        </Label>
        <textarea
          id="denial-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          rows={3}
          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          placeholder="Why this will not be paid"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-3 border-red-300 text-red-700 hover:bg-red-50"
        disabled={saving !== null}
        onClick={() => void submit("denied")}
      >
        {saving === "denied" ? "Denying…" : "Deny payment"}
      </Button>

      {message ? <p className="mt-3 text-sm text-gray-800">{message}</p> : null}
    </div>
  );
}
