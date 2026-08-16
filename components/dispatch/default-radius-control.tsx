"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DISPATCH_DEFAULTS } from "@/lib/dispatch/constants";

type Props = {
  initialRadiusKm: number;
};

export function DefaultRadiusControl({ initialRadiusKm }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(String(initialRadiusKm));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    const km = Number(value);
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/dispatch-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_service_radius_km: km }),
      });
      const data = (await res.json()) as {
        error?: string;
        default_service_radius_km?: number;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      if (data.default_service_radius_km != null) {
        setValue(String(data.default_service_radius_km));
      }
      setMessage(`Default radius is now ${data.default_service_radius_km ?? km} km.`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Default service radius
      </Label>
      <p className="mt-1 text-sm text-gray-600">
        Applies to every agent without a personal override. Matching offers to
        the nearest agent whose pin is inside this circle.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="default-radius" className="text-xs text-gray-500">
            Kilometres
          </Label>
          <Input
            id="default-radius"
            type="number"
            min={DISPATCH_DEFAULTS.minServiceRadiusKm}
            max={DISPATCH_DEFAULTS.maxServiceRadiusKm}
            step="0.5"
            className="w-28"
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save default"}
        </Button>
      </div>
      {message ? <p className="mt-2 text-sm text-gray-600">{message}</p> : null}
    </div>
  );
}
