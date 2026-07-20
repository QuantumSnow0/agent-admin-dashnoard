"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, ExternalLink, Loader2, Send } from "lucide-react";
import type { AdminRegistrationRow } from "@/lib/admin-registrations";
import { RegistrationPackageBadge } from "@/components/registrations/registration-package-badge";
import { RegistrationStatusActions } from "@/components/agents/registration-status-actions";
import { RegistrationCommissionEditor } from "@/components/registrations/registration-commission-editor";
import { formatRegistrationStatusLabel } from "@/lib/registration-statuses";
import { Button } from "@/components/ui/button";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const raw = value !== null && value !== undefined ? String(value).trim() : "";
  const display = raw.length > 0 ? raw : "—";
  return (
    <div className="flex flex-col gap-0.5 border-b border-gray-100 py-2.5 sm:flex-row sm:gap-4">
      <dt className="w-full shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:w-40">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-sm text-gray-900">{display}</dd>
    </div>
  );
}

function hasText(v: string | null | undefined): boolean {
  return v != null && String(v).trim().length > 0;
}

interface RegistrationDetailPanelProps {
  registration: AdminRegistrationRow;
  open: boolean;
  onClose: () => void;
}

export function RegistrationDetailPanel({ registration, open, onClose }: RegistrationDetailPanelProps) {
  const router = useRouter();
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [localMsFormsId, setLocalMsFormsId] = useState(
    registration.ms_forms_response_id,
  );
  const [localMsFormsAt, setLocalMsFormsAt] = useState(
    registration.ms_forms_submitted_at,
  );

  useEffect(() => {
    setLocalMsFormsId(registration.ms_forms_response_id);
    setLocalMsFormsAt(registration.ms_forms_submitted_at);
    setSubmitMessage(null);
  }, [registration.id, registration.ms_forms_response_id, registration.ms_forms_submitted_at]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const agentName = (Array.isArray(registration.agents) ? registration.agents[0]?.name : registration.agents?.name) ?? "—";

  const safPkg = registration.safaricom_service_package ?? "";
  const isFiber = safPkg === "home_business_fiber";
  const isPortable = safPkg === "safaricom_portable_5g";
  const isDedicated = safPkg === "safaricom_dedicated_wifi";

  const needsMsFormsSubmit =
    registration.source === "airtel" && !hasText(localMsFormsId);

  const showMsForms =
    registration.source === "airtel" &&
    (hasText(localMsFormsId) || hasText(localMsFormsAt));

  const handleSubmitToAirtel = async () => {
    setSubmitLoading(true);
    setSubmitMessage(null);
    try {
      const res = await fetch(
        `/api/admin/registrations/${registration.id}/submit-ms-forms`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Could not submit to Airtel");
      }
      setLocalMsFormsId(String(data.responseId ?? "submitted"));
      setLocalMsFormsAt(new Date().toISOString());
      setSubmitMessage({
        type: "success",
        text: data.alreadySubmitted
          ? "Already on Airtel (MS Forms)."
          : "Submitted to Airtel. Removed from Airtel queue.",
      });
      router.refresh();
    } catch (err: unknown) {
      setSubmitMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Submission failed",
      });
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        aria-label="Close details"
      />

      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl transition-transform duration-200 ease-out sm:max-w-lg ${
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {registration.source === "safaricom" ? "Safaricom registration" : "Airtel registration"}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-gray-900">
              {registration.customer_name || "Customer"}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium capitalize text-gray-700">
                {formatRegistrationStatusLabel(registration.status)}
              </span>
              <RegistrationPackageBadge reg={registration} />
              {needsMsFormsSubmit ? (
                <span className="inline-flex rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Airtel queue
                </span>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {submitMessage ? (
            <p
              className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                submitMessage.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {submitMessage.text}
            </p>
          ) : null}

          <dl>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-400">Agent</h3>
            <div className="flex flex-col gap-0.5 border-b border-gray-100 py-2.5 sm:flex-row sm:gap-4">
              <dt className="w-full shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:w-40">
                Agent
              </dt>
              <dd className="min-w-0 flex-1">
                <Link
                  href={`/dashboard/agents/${registration.agent_id}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {agentName}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </dd>
            </div>

            {registration.source === "airtel" ? (
              <>
                <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Customer</h3>
                <Field label="Email" value={registration.email} />
                <Field label="Airtel number" value={registration.airtel_number} />
                <Field label="Alternate number" value={registration.alternate_number} />

                <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Product</h3>
                <Field label="Preferred package" value={registration.preferred_package} />
                <Field
                  label="Quantity (units)"
                  value={String(registration.units_required ?? 1)}
                />

                <RegistrationCommissionEditor registration={registration} />

                <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Installation</h3>
                <Field label="Installation town" value={registration.installation_town} />
                <Field label="Delivery landmark" value={registration.delivery_landmark} />
                <Field label="Installation location" value={registration.installation_location} />

                <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Visit</h3>
                <Field label="Visit date" value={registration.visit_date} />
                <Field label="Visit time" value={registration.visit_time} />

                {showMsForms ? (
                  <>
                    <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Microsoft Forms</h3>
                    <Field label="Response ID" value={localMsFormsId} />
                    <Field label="Submitted at" value={fmtDate(localMsFormsAt)} />
                  </>
                ) : needsMsFormsSubmit ? (
                  <>
                    <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Microsoft Forms</h3>
                    <p className="py-2 text-sm text-amber-800">
                      Not submitted to Airtel yet. Use Submit to Airtel below if auto-submit failed.
                    </p>
                  </>
                ) : null}

                <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Record</h3>
                <Field label="Created" value={fmtDate(registration.created_at)} />
                <Field label="Updated" value={fmtDate(registration.updated_at)} />
              </>
            ) : (
              <>
                <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Customer</h3>
                <Field label="Email" value={registration.email} />
                <Field label="Safaricom number" value={registration.safaricom_number} />
                <Field label="Alternate number" value={registration.alternate_number} />
                <Field label="Identification number" value={registration.identification_number} />
                <Field label="Date of birth" value={registration.date_of_birth} />

                <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Product</h3>
                <Field label="Package" value={registration.preferred_package} />
                {isFiber ? <Field label="Fibre deal" value={registration.fiber_deal_id} /> : null}
                {isPortable ? <Field label="Portable 5G deal" value={registration.portable_deal_id} /> : null}
                {isDedicated ? <Field label="Dedicated Wi-Fi deal" value={registration.dedicated_wifi_deal_id} /> : null}

                {isFiber ? (
                  <>
                    <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Fibre location</h3>
                    <Field label="Region" value={registration.fiber_region_name} />
                    <Field label="Cluster" value={registration.fiber_cluster_name} />
                    <Field label="Estate ID" value={registration.fiber_estate_id} />
                    <Field label="Estate name" value={registration.fiber_estate_name} />
                  </>
                ) : null}

                {isPortable || isDedicated ? (
                  <>
                    <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Install site</h3>
                    <Field label="County" value={registration.install_county} />
                    <Field label="Town" value={registration.install_town} />
                    <Field label="Landmark" value={registration.install_landmark} />
                  </>
                ) : null}

                <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider text-gray-400">Record</h3>
                <Field label="Created" value={fmtDate(registration.created_at)} />
                <Field label="Updated" value={fmtDate(registration.updated_at)} />
              </>
            )}
          </dl>
        </div>

        <footer className="shrink-0 border-t border-gray-100 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <RegistrationStatusActions
              registration={{ id: registration.id, status: registration.status, source: registration.source }}
            />
            {needsMsFormsSubmit ? (
              <Button
                type="button"
                onClick={() => void handleSubmitToAirtel()}
                disabled={submitLoading}
                className="bg-red-600 hover:bg-red-700"
              >
                {submitLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Submit to Airtel
                  </>
                )}
              </Button>
            ) : null}
          </div>
        </footer>
      </aside>
    </>
  );
}
