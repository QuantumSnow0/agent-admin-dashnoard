"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminRegistrationRow } from "@/lib/admin-registrations";
import {
  getAirtelCommissionKesForRegistration,
  PREMIUM_COMMISSION,
  STANDARD_COMMISSION,
} from "@/lib/commissions";
import {
  getEffectiveCommissionPackage,
  getEffectiveCommissionUnits,
  hasCommissionOverride,
} from "@/lib/airtel-commission-effective";

type Props = {
  registration: AdminRegistrationRow;
};

export function RegistrationCommissionEditor({ registration }: Props) {
  const router = useRouter();
  const [useOverride, setUseOverride] = useState(
    hasCommissionOverride(registration)
  );
  const [pkg, setPkg] = useState<"standard" | "premium">(
    getEffectiveCommissionPackage(registration)
  );
  const [units, setUnits] = useState(
    String(getEffectiveCommissionUnits(registration))
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setUseOverride(hasCommissionOverride(registration));
    setPkg(getEffectiveCommissionPackage(registration));
    setUnits(String(getEffectiveCommissionUnits(registration)));
  }, [registration]);

  const registeredPkg = registration.preferred_package ?? "standard";
  const registeredUnits = registration.units_required ?? 1;

  const previewKes = useMemo(() => {
    const row = useOverride
      ? {
          commission_package: pkg,
          commission_units: Number(units) || 1,
          preferred_package: registeredPkg,
          units_required: registeredUnits,
          status: registration.status,
        }
      : {
          preferred_package: registeredPkg,
          units_required: registeredUnits,
          status: registration.status,
        };
    return getAirtelCommissionKesForRegistration(row);
  }, [useOverride, pkg, units, registeredPkg, registeredUnits, registration.status]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/registrations/${registration.id}/commission`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            useOverride
              ? {
                  commissionPackage: pkg,
                  commissionUnits: Number(units) || 1,
                }
              : { clearOverride: true }
          ),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to save");
      }
      setMessage("Commission basis updated. Agent balance recalculated.");
      router.refresh();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (registration.status !== "installed") {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">Commission basis</p>
        <p className="mt-1 text-amber-800">
          Mark this registration as <strong>Installed</strong> first, then you can
          adjust package/units if what was installed differs from what the agent
          registered.
        </p>
        <p className="mt-2 text-xs text-amber-700">
          Registered: {registeredPkg} · {registeredUnits} unit
          {registeredUnits === 1 ? "" : "s"}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-indigo-800">
        Commission basis
      </p>
      <p className="mt-1 text-xs text-indigo-700">
        Agent registered{" "}
        <strong className="capitalize">{registeredPkg}</strong> ·{" "}
        <strong>{registeredUnits}</strong> unit{registeredUnits === 1 ? "" : "s"}.
        Override below if the actual install was different.
      </p>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={useOverride}
          onChange={(e) => setUseOverride(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        Use custom commission (different from registration)
      </label>

      {useOverride ? (
        <div className="mt-3 space-y-3">
          <div>
            <Label className="text-xs text-gray-600">Installed package</Label>
            <Select value={pkg} onValueChange={(v) => setPkg(v as "standard" | "premium")}>
              <SelectTrigger className="mt-1 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">
                  Standard (KSh {STANDARD_COMMISSION} / unit)
                </SelectItem>
                <SelectItem value="premium">
                  Premium (KSh {PREMIUM_COMMISSION} / unit)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-gray-600">Units installed</Label>
            <Select value={units} onValueChange={setUnits}>
              <SelectTrigger className="mt-1 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 unit</SelectItem>
                <SelectItem value="2">2 units</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-sm font-medium text-gray-900">
        Commission for this install:{" "}
        <span className="text-indigo-700">KSh {previewKes.toLocaleString("en-KE")}</span>
      </p>

      {message ? (
        <p
          className={`mt-2 text-xs ${
            message.includes("updated") ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {message}
        </p>
      ) : null}

      <Button
        type="button"
        size="sm"
        className="mt-3"
        disabled={saving}
        onClick={save}
      >
        {saving ? "Saving…" : "Save commission basis"}
      </Button>
    </div>
  );
}
