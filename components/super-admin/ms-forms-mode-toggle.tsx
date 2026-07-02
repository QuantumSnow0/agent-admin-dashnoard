"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MSFormsSubmissionMode } from "@/lib/ms-forms-config";

type Props = {
  initialMode: MSFormsSubmissionMode;
  pendingCount: number;
};

export function MSFormsModeToggle({ initialMode, pendingCount }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<MSFormsSubmissionMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const setSubmissionMode = async (next: MSFormsSubmissionMode) => {
    if (next === mode || saving) return;

    const switchingToAuto = next === "auto" && mode === "manual";
    if (
      switchingToAuto &&
      pendingCount > 0 &&
      !window.confirm(
        `Switch to automatic MS Forms submission?\n\nNew leads will submit automatically. You still have ${pendingCount} pending lead(s) in the queue — use "Submit all pending" after switching if you want those sent now.`
      )
    ) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/super-admin/ms-forms-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionMode: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update mode");
      }
      setMode(next);
      setMessage(
        next === "auto"
          ? "Automatic mode on — new Airtel leads will submit to MS Forms when saved."
          : "Manual mode on — submit leads from this queue."
      );
      router.refresh();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to update mode");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            MS Forms submission
          </p>
          <p className="mt-1 text-sm text-slate-300">
            {mode === "auto"
              ? "New leads are submitted by the server automatically (agent app update not required)."
              : "You submit leads manually from the queue below."}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-600 bg-slate-950 p-1">
          <button
            type="button"
            disabled={saving}
            onClick={() => setSubmissionMode("auto")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "auto"
                ? "bg-emerald-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Automatic
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setSubmissionMode("manual")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "manual"
                ? "bg-amber-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Manual
          </button>
        </div>
      </div>
      {message ? (
        <p
          className={`mt-2 text-xs ${
            message.includes("Failed") ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
