"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { AdminGooglePlace, PlacesPrediction } from "@/lib/google-places/places-server";

function newSessionToken() {
  return crypto.randomUUID();
}

type Props = {
  onSelect: (place: AdminGooglePlace) => void;
  disabled?: boolean;
};

export function AdminPlacesSearch({ onSelect, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<PlacesPrediction[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef(newSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const search = async (value: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/places/autocomplete?q=${encodeURIComponent(value)}&session=${sessionRef.current}`,
      );
      const data = (await res.json()) as {
        predictions?: PlacesPrediction[];
        status?: string | null;
      };
      setPredictions(data.predictions ?? []);
      setStatus(data.status ?? null);
    } catch {
      setPredictions([]);
      setStatus("Could not search places. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setPredictions([]);
      setStatus(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void search(value);
    }, 220);
  };

  const pick = async (item: PlacesPrediction) => {
    setLoading(true);
    setStatus(null);
    try {
      const params = new URLSearchParams({
        placeId: item.placeId,
        session: sessionRef.current,
        label: item.label,
        secondary: item.secondary,
      });
      const res = await fetch(`/api/admin/places/details?${params.toString()}`);
      const data = (await res.json()) as {
        place?: AdminGooglePlace | null;
        status?: string | null;
      };
      sessionRef.current = newSessionToken();
      if (!data.place) {
        setStatus(data.status ?? "Could not load that place.");
        return;
      }
      setQuery(data.place.name);
      setPredictions([]);
      onSelect(data.place);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search a shop, church, or building"
        disabled={disabled}
        autoComplete="off"
      />
      {loading ? (
        <p className="mt-1 text-xs text-gray-500">Searching…</p>
      ) : status && predictions.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">{status}</p>
      ) : null}
      {predictions.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {predictions.map((item) => (
            <li key={item.placeId}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-gray-50"
                onClick={() => void pick(item)}
              >
                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                {item.secondary ? (
                  <p className="text-xs text-gray-500">{item.secondary}</p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
