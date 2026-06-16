"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SuperAdminDetailPanel } from "@/components/super-admin/super-admin-detail-panel";
import type { SuperAdminRegistrationDetail } from "@/lib/super-admin-types";
import type { SuperAdminQueueRow } from "@/app/super-admin/page";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type Props = {
  initialPending: SuperAdminQueueRow[];
  initialSubmitted: SuperAdminQueueRow[];
};

export function SuperAdminQueue({ initialPending, initialSubmitted }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(initialPending);
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"pending" | "submitted">("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SuperAdminRegistrationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/super-admin/registration/${id}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load details");
      }
      setDetail(data.detail);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : "Failed to load details");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  };

  const submitOne = async (id: string) => {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/super-admin/submit-ms-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId: id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Submission failed");
      }
      setMessage({
        type: "success",
        text: `Submitted successfully. Response ID: ${data.responseId ?? "OK"}`,
      });
      router.refresh();
      setPending((rows) => rows.filter((r) => r.id !== id));
      if (selectedId === id) {
        await loadDetail(id);
      }
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "Submission failed";
      setMessage({ type: "error", text });
    } finally {
      setBusyId(null);
    }
  };

  const submitAll = async () => {
    if (pending.length === 0) return;
    setBusyId("__bulk__");
    setMessage(null);
    let ok = 0;
    let fail = 0;
    const errors: string[] = [];

    for (const row of pending) {
      try {
        const res = await fetch("/api/super-admin/submit-ms-forms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registrationId: row.id }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          fail++;
          errors.push(`${row.customer_name}: ${data.error ?? "Failed"}`);
        } else {
          ok++;
        }
      } catch (err: unknown) {
        fail++;
        errors.push(
          `${row.customer_name}: ${err instanceof Error ? err.message : "Failed"}`
        );
      }
    }

    setBusyId(null);
    router.refresh();
    if (fail === 0) {
      setMessage({ type: "success", text: `Submitted ${ok} registration(s).` });
      setPending([]);
      if (selectedId) closeDetail();
    } else {
      setMessage({
        type: "error",
        text: `${ok} succeeded, ${fail} failed. ${errors[0] ?? ""}`,
      });
    }
  };

  const selectedRow =
    pending.find((r) => r.id === selectedId) ??
    submitted.find((r) => r.id === selectedId);
  const showSubmitInPanel =
    activeTab === "pending" &&
    !!selectedRow &&
    !selectedRow.ms_forms_response_id;

  return (
    <div className="space-y-4">
      {message ? (
        <div
          className={`rounded-lg border p-3 text-sm ${
            message.type === "success"
              ? "border-emerald-800 bg-emerald-950 text-emerald-200"
              : "border-red-800 bg-red-950 text-red-200"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="flex min-h-[520px] overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50">
        <div className="min-w-0 flex-1 overflow-auto p-4">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "pending" | "submitted")}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <TabsList className="bg-slate-950">
                <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
                <TabsTrigger value="submitted">
                  Recently sent ({submitted.length})
                </TabsTrigger>
              </TabsList>
              {pending.length > 0 ? (
                <Button
                  type="button"
                  disabled={busyId !== null}
                  onClick={submitAll}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {busyId === "__bulk__"
                    ? "Submitting…"
                    : `Submit all (${pending.length})`}
                </Button>
              ) : null}
            </div>

            <TabsContent value="pending" className="mt-0">
              {pending.length === 0 ? (
                <p className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
                  No registrations waiting for MS Forms.
                </p>
              ) : (
                <QueueTable
                  rows={pending}
                  busyId={busyId}
                  selectedId={selectedId}
                  onSelectCustomer={loadDetail}
                  onSubmit={submitOne}
                  showSubmit
                />
              )}
            </TabsContent>

            <TabsContent value="submitted" className="mt-0">
              {submitted.length === 0 ? (
                <p className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
                  No recent submissions.
                </p>
              ) : (
                <QueueTable
                  rows={submitted}
                  busyId={busyId}
                  selectedId={selectedId}
                  onSelectCustomer={loadDetail}
                  showSubmit={false}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>

        {selectedId ? (
          <SuperAdminDetailPanel
            open
            loading={detailLoading}
            error={detailError}
            detail={detail}
            onClose={closeDetail}
            onSubmit={() => submitOne(selectedId)}
            submitting={busyId === selectedId}
            showSubmit={showSubmitInPanel}
          />
        ) : null}
      </div>

      {!selectedId ? (
        <p className="text-xs text-slate-500">
          Click a customer name to open full details (customer and agent).
        </p>
      ) : null}
    </div>
  );
}

function QueueTable({
  rows,
  busyId,
  selectedId,
  onSelectCustomer,
  onSubmit,
  showSubmit,
}: {
  rows: SuperAdminQueueRow[];
  busyId: string | null;
  selectedId: string | null;
  onSelectCustomer: (id: string) => void;
  onSubmit?: (id: string) => void;
  showSubmit: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-800">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400">Customer</TableHead>
            <TableHead className="text-slate-400">Agent</TableHead>
            <TableHead className="text-slate-400">Package / Town</TableHead>
            <TableHead className="text-slate-400">Created</TableHead>
            {showSubmit ? (
              <TableHead className="text-right text-slate-400">Action</TableHead>
            ) : (
              <TableHead className="text-slate-400">MS Forms</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isSelected = selectedId === row.id;
            return (
              <TableRow
                key={row.id}
                className={`border-slate-800 ${isSelected ? "bg-slate-800/80" : ""}`}
              >
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onSelectCustomer(row.id)}
                    className={`text-left transition-colors hover:text-blue-300 ${
                      isSelected ? "text-blue-300" : ""
                    }`}
                  >
                    <div className="font-medium text-slate-100">{row.customer_name}</div>
                    <div className="text-xs text-slate-500">{row.airtel_number}</div>
                  </button>
                </TableCell>
                <TableCell className="text-slate-300">{row.agent_name ?? "—"}</TableCell>
                <TableCell>
                  <div className="text-sm text-slate-300">{row.preferred_package}</div>
                  <div className="text-xs text-slate-500">{row.installation_town}</div>
                </TableCell>
                <TableCell className="text-sm text-slate-400">
                  {fmtDate(row.created_at)}
                </TableCell>
                {showSubmit ? (
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId !== null}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSubmit?.(row.id);
                      }}
                      className="bg-emerald-700 hover:bg-emerald-600"
                    >
                      {busyId === row.id ? "Sending…" : "Send to MS Forms"}
                    </Button>
                  </TableCell>
                ) : (
                  <TableCell>
                    <div className="text-xs text-slate-400">
                      {fmtDate(row.ms_forms_submitted_at)}
                    </div>
                    <div className="max-w-[140px] truncate text-xs text-slate-600">
                      {row.ms_forms_response_id}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
