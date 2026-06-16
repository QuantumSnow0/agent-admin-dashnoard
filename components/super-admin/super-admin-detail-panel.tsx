"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRegistrationStatusLabel } from "@/lib/registration-statuses";
import type { SuperAdminRegistrationDetail } from "@/lib/super-admin-types";

function fmtDate(iso: string | null | undefined): string {
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

function fmtMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `KSh ${value.toLocaleString("en-KE")}`;
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const display =
    value !== null && value !== undefined && String(value).trim() !== ""
      ? String(value)
      : "—";
  return (
    <div className="border-b border-slate-800 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-slate-100">{display}</dd>
    </div>
  );
}

type Props = {
  open: boolean;
  loading: boolean;
  error: string | null;
  detail: SuperAdminRegistrationDetail | null;
  onClose: () => void;
  onSubmit?: () => void;
  submitting?: boolean;
  showSubmit?: boolean;
};

export function SuperAdminDetailPanel({
  open,
  loading,
  error,
  detail,
  onClose,
  onSubmit,
  submitting,
  showSubmit,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const agent = detail?.agent;

  return (
    <aside className="flex h-full w-full max-w-md shrink-0 flex-col border-l border-slate-800 bg-slate-900 lg:max-w-lg">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Registration
          </p>
          <h2 className="mt-1 truncate text-lg font-semibold text-white">
            {detail?.customer_name ?? (loading ? "Loading…" : "Customer")}
          </h2>
          {detail ? (
            <span className="mt-2 inline-flex rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs font-medium capitalize text-slate-300">
              {formatRegistrationStatusLabel(detail.status)}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-slate-400 hover:bg-slate-800 hover:text-white"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading details…</p>
        ) : error ? (
          <p className="rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-300">
            {error}
          </p>
        ) : detail ? (
          <Tabs defaultValue="customer" className="w-full">
            <TabsList className="mb-4 grid w-full grid-cols-2 bg-slate-950">
              <TabsTrigger value="customer">Customer</TabsTrigger>
              <TabsTrigger value="agent">Agent</TabsTrigger>
            </TabsList>

            <TabsContent value="customer" className="mt-0">
              <dl>
                <Field label="Registration ID" value={detail.id} />
                <Field label="Customer name" value={detail.customer_name} />
                <Field label="Airtel number" value={detail.airtel_number} />
                <Field label="Alternate number" value={detail.alternate_number} />
                <Field label="Email" value={detail.email} />
                <Field label="Package" value={detail.preferred_package} />
                <Field label="Units / devices" value={detail.units_required} />
                <Field label="Installation town" value={detail.installation_town} />
                <Field label="Installation location" value={detail.installation_location} />
                <Field label="Delivery landmark" value={detail.delivery_landmark} />
                <Field
                  label="Visit"
                  value={[detail.visit_date, detail.visit_time].filter(Boolean).join(" · ")}
                />
                <Field label="Status" value={formatRegistrationStatusLabel(detail.status)} />
                <Field label="Created" value={fmtDate(detail.created_at)} />
                <Field label="Updated" value={fmtDate(detail.updated_at)} />
                <Field label="MS Forms response ID" value={detail.ms_forms_response_id} />
                <Field label="MS Forms submitted" value={fmtDate(detail.ms_forms_submitted_at)} />
              </dl>
            </TabsContent>

            <TabsContent value="agent" className="mt-0">
              {agent ? (
                <dl>
                  <Field label="Agent ID" value={agent.id} />
                  <Field label="Name" value={agent.name} />
                  <Field label="Email" value={agent.email} />
                  <Field label="Airtel phone" value={agent.airtel_phone} />
                  <Field label="Safaricom phone" value={agent.safaricom_phone} />
                  <Field label="Town" value={agent.town} />
                  <Field label="Area" value={agent.area} />
                  <Field label="Account status" value={agent.status} />
                  <Field label="Total earnings" value={fmtMoney(agent.total_earnings)} />
                  <Field label="Available balance" value={fmtMoney(agent.available_balance)} />
                  <Field label="Joined" value={fmtDate(agent.created_at)} />
                </dl>
              ) : (
                <p className="py-6 text-sm text-slate-400">Agent record not found.</p>
              )}
            </TabsContent>
          </Tabs>
        ) : null}
      </div>

      {showSubmit && detail && !detail.ms_forms_response_id && onSubmit ? (
        <footer className="shrink-0 border-t border-slate-800 p-4">
          <Button
            type="button"
            className="w-full bg-emerald-700 hover:bg-emerald-600"
            disabled={submitting}
            onClick={onSubmit}
          >
            {submitting ? "Sending to MS Forms…" : "Send to MS Forms"}
          </Button>
        </footer>
      ) : null}
    </aside>
  );
}
