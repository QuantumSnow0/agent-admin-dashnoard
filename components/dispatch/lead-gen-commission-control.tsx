"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = {
  initialSubmitterStandardKes: number;
  initialSubmitterPremiumKes: number;
  initialReceiverStandardKes: number;
  initialReceiverPremiumKes: number;
};

function parseKes(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
  return Math.round(n);
}

export function LeadGenCommissionControl({
  initialSubmitterStandardKes,
  initialSubmitterPremiumKes,
  initialReceiverStandardKes,
  initialReceiverPremiumKes,
}: Props) {
  const router = useRouter();
  const [submitterStd, setSubmitterStd] = useState(
    String(initialSubmitterStandardKes),
  );
  const [submitterPrem, setSubmitterPrem] = useState(
    String(initialSubmitterPremiumKes),
  );
  const [receiverStd, setReceiverStd] = useState(
    String(initialReceiverStandardKes),
  );
  const [receiverPrem, setReceiverPrem] = useState(
    String(initialReceiverPremiumKes),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  useEffect(() => {
    setSubmitterStd(String(initialSubmitterStandardKes));
    setSubmitterPrem(String(initialSubmitterPremiumKes));
    setReceiverStd(String(initialReceiverStandardKes));
    setReceiverPrem(String(initialReceiverPremiumKes));
  }, [
    initialSubmitterStandardKes,
    initialSubmitterPremiumKes,
    initialReceiverStandardKes,
    initialReceiverPremiumKes,
  ]);

  const save = async () => {
    const submitterStandard = parseKes(submitterStd);
    const submitterPremium = parseKes(submitterPrem);
    const receiverStandard = parseKes(receiverStd);
    const receiverPremium = parseKes(receiverPrem);
    if (
      submitterStandard == null ||
      submitterPremium == null ||
      receiverStandard == null ||
      receiverPremium == null
    ) {
      setMessage({
        type: "err",
        text: "Enter valid amounts (0–100000 KSh) for each package.",
      });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/dispatch-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_submitter_commission_standard_kes: submitterStandard,
          lead_submitter_commission_premium_kes: submitterPremium,
          lead_receiver_commission_standard_kes: receiverStandard,
          lead_receiver_commission_premium_kes: receiverPremium,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        lead_submitter_commission_standard_kes?: number;
        lead_submitter_commission_premium_kes?: number;
        lead_receiver_commission_standard_kes?: number;
        lead_receiver_commission_premium_kes?: number;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");

      const nextSubmitterStd =
        data.lead_submitter_commission_standard_kes ?? submitterStandard;
      const nextSubmitterPrem =
        data.lead_submitter_commission_premium_kes ?? submitterPremium;
      const nextReceiverStd =
        data.lead_receiver_commission_standard_kes ?? receiverStandard;
      const nextReceiverPrem =
        data.lead_receiver_commission_premium_kes ?? receiverPremium;

      setSubmitterStd(String(nextSubmitterStd));
      setSubmitterPrem(String(nextSubmitterPrem));
      setReceiverStd(String(nextReceiverStd));
      setReceiverPrem(String(nextReceiverPrem));
      setMessage({
        type: "ok",
        text: `Saved. Finder: standard KSh ${nextSubmitterStd.toLocaleString()} / premium KSh ${nextSubmitterPrem.toLocaleString()}. Installer: standard KSh ${nextReceiverStd.toLocaleString()} / premium KSh ${nextReceiverPrem.toLocaleString()}.`,
      });
      router.refresh();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  };

  const formatCurrent = (n: number) =>
    n > 0 ? `KSh ${n.toLocaleString()}` : "hidden";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Non-installer lead fees
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Separate fees for standard and premium packages. Website leads still
            use the fixed KSh 200 install fee. Set a fee to 0 to hide it in the
            agent app.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700">
          Finder {formatCurrent(initialSubmitterStandardKes)} /{" "}
          {formatCurrent(initialSubmitterPremiumKes)}
          {" · "}
          Installer {formatCurrent(initialReceiverStandardKes)} /{" "}
          {formatCurrent(initialReceiverPremiumKes)}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Submitter fee (finder)
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="lead-submitter-std" className="text-xs text-gray-700">
              Standard
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">KSh</span>
              <Input
                id="lead-submitter-std"
                type="number"
                min={0}
                max={100000}
                step="1"
                className="w-28"
                value={submitterStd}
                disabled={saving}
                onChange={(e) => setSubmitterStd(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-submitter-prem" className="text-xs text-gray-700">
              Premium
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">KSh</span>
              <Input
                id="lead-submitter-prem"
                type="number"
                min={0}
                max={100000}
                step="1"
                className="w-28"
                value={submitterPrem}
                disabled={saving}
                onChange={(e) => setSubmitterPrem(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Receiver / installer fee
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="lead-receiver-std" className="text-xs text-gray-700">
              Standard
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">KSh</span>
              <Input
                id="lead-receiver-std"
                type="number"
                min={0}
                max={100000}
                step="1"
                className="w-28"
                value={receiverStd}
                disabled={saving}
                onChange={(e) => setReceiverStd(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-receiver-prem" className="text-xs text-gray-700">
              Premium
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">KSh</span>
              <Input
                id="lead-receiver-prem"
                type="number"
                min={0}
                max={100000}
                step="1"
                className="w-28"
                value={receiverPrem}
                disabled={saving}
                onChange={(e) => setReceiverPrem(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save fees"}
        </Button>
      </div>

      {message ? (
        <p
          className={`mt-3 text-sm ${
            message.type === "ok" ? "text-emerald-800" : "text-red-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
