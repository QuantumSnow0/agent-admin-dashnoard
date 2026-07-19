"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = {
  agentId: string;
  initialEnabled: boolean;
  initialPriority: number;
};

export function AgentFallbackDispatchControl({
  agentId,
  initialEnabled,
  initialPriority,
}: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [priority, setPriority] = useState(String(initialPriority ?? 100));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (nextEnabled: boolean, nextPriority?: number) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/fallback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_fallback_agent: nextEnabled,
          fallback_priority:
            nextPriority ??
            Math.max(0, Math.round(Number(priority) || 100)),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update");
      }
      setEnabled(nextEnabled);
      if (nextPriority != null) setPriority(String(nextPriority));
      setMessage(
        nextEnabled
          ? "This agent is now a designated fallback."
          : "Fallback designation removed.",
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Designated fallback agent
      </Label>
      <p className="mt-1 text-sm text-gray-600">
        When no agent is available in the customer&apos;s county (or the order
        was declined / town unknown), offer this lead to designated fallback
        agents <strong>one at a time</strong> before the admin queue. Agent must
        still be Available and within product scope.
      </p>

      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-gray-300"
          checked={enabled}
          disabled={saving}
          onChange={(e) => void save(e.target.checked)}
        />
        <span className="text-sm text-gray-800">
          <span className="font-medium">Receive overflow / failed-county leads</span>
          <span className="mt-0.5 block text-xs text-gray-500">
            Same accept/decline flow as normal county offers.
          </span>
        </span>
      </label>

      {enabled ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor={`fallback-priority-${agentId}`} className="text-xs text-gray-500">
              Priority (lower = first)
            </Label>
            <Input
              id={`fallback-priority-${agentId}`}
              type="number"
              min={0}
              max={9999}
              className="w-28"
              value={priority}
              disabled={saving}
              onChange={(e) => setPriority(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() =>
              void save(true, Math.max(0, Math.round(Number(priority) || 100)))
            }
          >
            Save priority
          </Button>
        </div>
      ) : null}

      {message ? <p className="mt-2 text-sm text-gray-600">{message}</p> : null}
    </div>
  );
}
