"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type AgentPaymentManagerProps = {
  agentId: string;
  totalEarnings: number;
  paidFromLedger: number;
  currentBalance: number;
};

type PaymentRow = {
  id: string;
  amount_ksh: number;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

export function AgentPaymentManager({
  agentId,
  totalEarnings,
  paidFromLedger,
  currentBalance,
}: AgentPaymentManagerProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [reversingPaymentId, setReversingPaymentId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [ledgerReady, setLedgerReady] = useState(true);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const canSubmit = useMemo(() => {
    const parsed = Number(amount);
    return Number.isFinite(parsed) && parsed > 0 && !isSaving;
  }, [amount, isSaving]);

  const loadPayments = async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("agent_payments")
        .select("id, amount_ksh, reference, notes, created_at")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("does not exist") || msg.includes("agent_payments")) {
          setLedgerReady(false);
          setHistoryError(
            "Payment ledger table is missing. Run migration `add_agent_payments_ledger.sql`."
          );
          setPayments([]);
          return;
        }
        setHistoryError(error.message);
        setPayments([]);
        return;
      }

      setLedgerReady(true);
      setPayments((data ?? []) as PaymentRow[]);
    } catch (error) {
      console.error("Failed to load payment history", error);
      setHistoryError("Failed to load payment history.");
      setPayments([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    void loadPayments();
  }, [agentId]);

  const handleRecordPayment = async () => {
    if (!ledgerReady) {
      alert("Run migration `add_agent_payments_ledger.sql` first.");
      return;
    }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      alert("Enter a valid payment amount.");
      return;
    }

    setIsSaving(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        alert("You must be logged in as admin.");
        return;
      }

      const { error: insertError } = await supabase.from("agent_payments").insert({
        agent_id: agentId,
        amount_ksh: parsed,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        created_by: user.id,
      });

      if (insertError) {
        alert(`Failed to record payment history: ${insertError.message}`);
        return;
      }

      setAmount("");
      setReference("");
      setNotes("");
      await loadPayments();
      router.refresh();
    } catch (error) {
      console.error("Failed to save payment", error);
      alert("Failed to save payment.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReversePayment = async (payment: PaymentRow) => {
    const confirmed = window.confirm(
      `Reverse payment of KSh ${Number(payment.amount_ksh || 0).toLocaleString()}? This will restore the amount to agent balance and remove the payment record.`
    );
    if (!confirmed) return;

    setReversingPaymentId(payment.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("admin_reverse_agent_payment", {
        p_payment_id: payment.id,
      });
      if (error) {
        const msg = (error.message || "").toLowerCase();
        const functionMissing =
          msg.includes("could not find the function") ||
          msg.includes("admin_reverse_agent_payment");
        if (!functionMissing) {
          alert(`Failed to reverse payment: ${error.message}`);
          return;
        }

        // Fallback path if SQL function is not yet available in schema cache:
        // delete the payment row (balance is derived from ledger on refresh).
        const { error: deleteError } = await supabase
          .from("agent_payments")
          .delete()
          .eq("id", payment.id);
        if (deleteError) {
          alert(`Failed to remove payment row: ${deleteError.message}`);
          return;
        }
      }
      await loadPayments();
      router.refresh();
    } catch (error) {
      console.error("Failed to reverse payment", error);
      alert("Failed to reverse payment.");
    } finally {
      setReversingPaymentId(null);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
        Payout Manager
      </div>
      <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
        <div>
          <span className="block text-gray-500">Total earned</span>
          <span className="font-semibold text-gray-900">
            KSh {totalEarnings.toLocaleString()}
          </span>
        </div>
        <div>
          <span className="block text-gray-500">Already paid</span>
          <span className="font-semibold text-gray-900">
            KSh {paidFromLedger.toLocaleString()}
          </span>
        </div>
        <div>
          <span className="block text-gray-500">Current balance</span>
          <span className="font-semibold text-gray-900">
            KSh {currentBalance.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount paid (KSh)"
          className="h-9 w-44 rounded border border-gray-300 px-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Reference (optional)"
          className="h-9 w-44 rounded border border-gray-300 px-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="h-9 w-56 rounded border border-gray-300 px-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={handleRecordPayment}
          disabled={!canSubmit}
          className="inline-flex h-9 items-center rounded bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSaving ? "Saving..." : "Record Payment"}
        </button>
      </div>

      <div className="mt-4 rounded-md border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
          Recent Payments
        </div>
        {isLoadingHistory ? (
          <div className="px-3 py-3 text-sm text-gray-500">Loading payment history...</div>
        ) : historyError ? (
          <div className="px-3 py-3 text-sm text-red-600">{historyError}</div>
        ) : payments.length === 0 ? (
          <div className="px-3 py-3 text-sm text-gray-500">No payments recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Notes</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-600">
                      {new Date(payment.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      KSh {Number(payment.amount_ksh || 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{payment.reference || "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{payment.notes || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleReversePayment(payment)}
                        disabled={reversingPaymentId === payment.id}
                        className="inline-flex h-7 items-center rounded border border-red-200 bg-red-50 px-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {reversingPaymentId === payment.id ? "Reversing..." : "Reverse"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

