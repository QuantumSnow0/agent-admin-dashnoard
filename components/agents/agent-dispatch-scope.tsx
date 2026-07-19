"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEAD_DISPATCH_SCOPES } from "@/lib/dispatch/constants";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SCOPE_LABELS: Record<string, string> = {
  both: "Airtel + Safaricom",
  airtel: "Airtel only",
  safaricom: "Safaricom only",
  none: "No inbound leads",
};

type Props = {
  agentId: string;
  initialScope: string;
};

export function AgentDispatchScopeControl({ agentId, initialScope }: Props) {
  const router = useRouter();
  const [scope, setScope] = useState(initialScope);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const saveScope = async (next: string) => {
    if (next === scope || saving) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/dispatch-scope`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to update scope");
      }
      setScope(next);
      setMessage("Lead dispatch scope updated.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to update scope");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Inbound lead dispatch
      </Label>
      <p className="mt-1 text-sm text-gray-600">
        Controls which website lead products this agent can receive when available.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Select value={scope} onValueChange={saveScope} disabled={saving}>
          <SelectTrigger className="w-full max-w-xs bg-white">
            <SelectValue placeholder="Select scope" />
          </SelectTrigger>
          <SelectContent>
            {LEAD_DISPATCH_SCOPES.map((value) => (
              <SelectItem key={value} value={value}>
                {SCOPE_LABELS[value] ?? value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-medium text-gray-700">
          {SCOPE_LABELS[scope] ?? scope}
        </span>
      </div>
      {message ? <p className="mt-2 text-sm text-gray-600">{message}</p> : null}
    </div>
  );
}
