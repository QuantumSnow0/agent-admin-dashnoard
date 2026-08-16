"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DISPATCH_DEFAULTS } from "@/lib/dispatch/constants";

type Props = {
  agentId: string;
  initialRadiusKm: number | null;
  defaultRadiusKm: number;
};

export function AgentServiceRadiusControl({
  agentId,
  initialRadiusKm,
  defaultRadiusKm,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(
    initialRadiusKm != null ? String(initialRadiusKm) : "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (next: number | null) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/service-radius`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_radius_km: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save radius");
      setMessage(
        next == null
          ? `Using the global default (${defaultRadiusKm} km).`
          : `Override set to ${next} km.`,
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save radius");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Service radius
      </Label>
      <p className="mt-1 text-sm text-gray-600">
        How far from this agent&apos;s working pin they can take jobs. Leave
        blank to use the global default ({defaultRadiusKm} km). Max{" "}
        {DISPATCH_DEFAULTS.maxServiceRadiusKm} km.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`radius-${agentId}`} className="text-xs text-gray-500">
            Override km
          </Label>
          <Input
            id={`radius-${agentId}`}
            type="number"
            min={DISPATCH_DEFAULTS.minServiceRadiusKm}
            max={DISPATCH_DEFAULTS.maxServiceRadiusKm}
            step="0.5"
            className="w-28"
            placeholder={String(defaultRadiusKm)}
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => {
            const raw = value.trim();
            if (!raw) {
              void save(null);
              return;
            }
            void save(Number(raw));
          }}
        >
          Save
        </Button>
        {value.trim() ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setValue("");
              void save(null);
            }}
          >
            Use default
          </Button>
        ) : null}
      </div>
      {message ? <p className="mt-2 text-sm text-gray-600">{message}</p> : null}
    </div>
  );
}
