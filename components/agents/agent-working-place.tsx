"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AdminPlacesSearch } from "@/components/places/admin-places-search";
import type { AdminGooglePlace } from "@/lib/google-places/places-server";
import { parsePreviewGooglePlace } from "@/lib/dispatch/matching";

type Props = {
  agentId: string;
  initialPlace: unknown;
  updatedAt: string | null;
};

export function AgentWorkingPlaceControl({
  agentId,
  initialPlace,
  updatedAt,
}: Props) {
  const router = useRouter();
  const [place, setPlace] = useState(() => parsePreviewGooglePlace(initialPlace));
  const [pending, setPending] = useState<AdminGooglePlace | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (next: AdminGooglePlace) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/working-place`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save pin");
      setPlace(parsePreviewGooglePlace(next));
      setPending(null);
      setMessage("Working pin updated.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save pin");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Working location pin
      </Label>
      <p className="mt-1 text-sm text-gray-600">
        Matching uses this Google pin against the customer pin. Search and pick a
        real landmark — not a city or county.
      </p>

      {place ? (
        <p className="mt-3 text-sm text-gray-900">
          <span className="font-medium">{place.name}</span>
          {place.formattedAddress ? (
            <span className="mt-0.5 block text-xs text-gray-500">
              {place.formattedAddress}
            </span>
          ) : null}
          {updatedAt ? (
            <span className="mt-0.5 block text-xs text-gray-400">
              Last updated {new Date(updatedAt).toLocaleString("en-KE")}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="mt-3 text-sm text-amber-800">No working pin set. This agent cannot receive pin-matched offers.</p>
      )}

      <div className="mt-3">
        <AdminPlacesSearch
          disabled={saving}
          onSelect={(next) => setPending(next)}
        />
      </div>

      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm text-gray-700">
            Save <span className="font-medium">{pending.name}</span>?
          </p>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void save(pending)}
          >
            {saving ? "Saving…" : "Save pin"}
          </Button>
        </div>
      ) : null}

      {message ? <p className="mt-2 text-sm text-gray-600">{message}</p> : null}
    </div>
  );
}
