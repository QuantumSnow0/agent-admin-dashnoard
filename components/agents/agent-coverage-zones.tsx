"use client";

import "leaflet/dist/leaflet.css";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Circle as LeafletCircle, LayerGroup, Map as LeafletMap } from "leaflet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AdminPlacesSearch } from "@/components/places/admin-places-search";
import { DISPATCH_DEFAULTS } from "@/lib/dispatch/constants";
import type { CoverageCollision, CoverageZoneRow, PinCircle } from "@/lib/dispatch/coverage-admin";

type OverlayCircle = {
  key: string;
  lat: number;
  lng: number;
  radiusKm: number;
  color: string;
  selectable?: boolean;
};

type Draft = {
  kind: "new" | "zone" | "pin";
  zoneId: string | null;
  name: string;
  placeId: string | null;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
  priority: number;
};

type Props = {
  agentId: string;
  agentName: string;
  initialZones: CoverageZoneRow[];
};

const NAIROBI = { lat: -1.286389, lng: 36.817223 };
const STREET_ZOOM = 17;
const START_RADIUS_KM = 1;

function isPlottable(lat: number, lng: number, radiusKm: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Number.isFinite(radiusKm) &&
    radiusKm > 0 &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

type CoverageMapHandle = {
  setDraftRadius: (radiusKm: number) => void;
};

const CoverageMapCanvas = memo(
  forwardRef<
    CoverageMapHandle,
    {
      overlays: OverlayCircle[];
      draft: Draft | null;
      initialCenter: { lat: number; lng: number } | null;
      className?: string;
      onDrop: (lat: number, lng: number) => void;
    }
  >(function CoverageMapCanvas({ overlays, draft, initialCenter, className, onDrop }, ref) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const overlayGroupRef = useRef<LayerGroup | null>(null);
  const draftCircleRef = useRef<LeafletCircle | null>(null);
  const overlaysRef = useRef(overlays);
  const draftRef = useRef(draft);
  const onDropRef = useRef(onDrop);
  const lastPinRef = useRef<{ lat: number; lng: number } | null>(null);
  const fitTimerRef = useRef<number | null>(null);
  overlaysRef.current = overlays;
  draftRef.current = draft;
  onDropRef.current = onDrop;

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    let disposed = false;

    void import("leaflet").then((mod) => {
      if (disposed || !wrapRef.current) return;
      const L = (mod.default ?? mod) as typeof import("leaflet");
      leafletRef.current = L;
      const el = wrapRef.current;
      delete (el as unknown as { _leaflet_id?: number })._leaflet_id;

      const start = initialCenter ?? NAIROBI;
      const map = L.map(el, {
        scrollWheelZoom: true,
        zoomControl: true,
      }).setView([start.lat, start.lng], STREET_ZOOM);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);
      const group = L.layerGroup().addTo(map);
      map.on("click", (event) => {
        onDropRef.current(event.latlng.lat, event.latlng.lng);
      });
      mapRef.current = map;
      overlayGroupRef.current = group;
      paintOverlays(L, group, overlaysRef.current);
      paintDraft(L, map, draftRef.current, draftCircleRef, lastPinRef, fitTimerRef, overlaysRef.current);
      window.setTimeout(() => {
        if (!disposed) map.invalidateSize();
      }, 250);
    });

    const resize = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        mapRef.current?.invalidateSize();
      });
    });
    if (wrapRef.current) resize.observe(wrapRef.current);

    return () => {
      disposed = true;
      resize.disconnect();
      if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
      overlayGroupRef.current = null;
      draftCircleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map is created once
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const group = overlayGroupRef.current;
    if (!L || !group) return;
    paintOverlays(L, group, overlays);
  }, [overlays]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !initialCenter || draftRef.current) return;
    map.setView([initialCenter.lat, initialCenter.lng], STREET_ZOOM);
  }, [initialCenter]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    paintDraft(L, map, draft, draftCircleRef, lastPinRef, fitTimerRef, overlays);
  }, [draft, overlays]);

  useImperativeHandle(ref, () => ({
    setDraftRadius(radiusKm) {
      const L = leafletRef.current;
      const circle = draftCircleRef.current;
      const map = mapRef.current;
      if (!L || !circle || !map || !Number.isFinite(radiusKm) || radiusKm <= 0) return;
      circle.setRadius(radiusKm * 1000);
      if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
      fitTimerRef.current = window.setTimeout(() => {
        fitDraftInContext(L, map, circle, overlaysRef.current);
      }, 80);
    },
  }));

  return (
    <div
      ref={wrapRef}
      className={className}
    />
  );
  }),
);

function RadiusSlider({
  value,
  disabled,
  onLive,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onLive: (km: number) => void;
  onCommit: (km: number) => void;
}) {
  const [km, setKm] = useState(value);
  useEffect(() => {
    setKm(value);
  }, [value]);

  return (
    <div className="space-y-1">
      <Label className="text-xs text-gray-500">Radius {km} km</Label>
      <input
        type="range"
        min={DISPATCH_DEFAULTS.minServiceRadiusKm}
        max={DISPATCH_DEFAULTS.maxServiceRadiusKm}
        step="0.5"
        value={km}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          setKm(next);
          onLive(next);
        }}
        onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="w-full"
      />
    </div>
  );
}

function paintOverlays(
  L: typeof import("leaflet"),
  group: LayerGroup,
  overlays: OverlayCircle[],
) {
  group.clearLayers();
  for (const item of overlays) {
    if (!isPlottable(item.lat, item.lng, item.radiusKm)) continue;
    L.circle([item.lat, item.lng], {
      radius: item.radiusKm * 1000,
      color: item.color,
      weight: item.selectable ? 2 : 1,
      fillOpacity: item.selectable ? 0.14 : 0.08,
      dashArray: item.selectable ? "7 5" : undefined,
      interactive: false,
    }).addTo(group);
  }
}

function circleBounds(
  L: typeof import("leaflet"),
  lat: number,
  lng: number,
  radiusKm: number,
) {
  return L.latLng(lat, lng).toBounds(radiusKm * 1000);
}

function fitDraftInContext(
  L: typeof import("leaflet"),
  map: LeafletMap,
  draftCircle: LeafletCircle,
  overlays: OverlayCircle[],
) {
  const center = draftCircle.getLatLng();
  const bounds = circleBounds(L, center.lat, center.lng, draftCircle.getRadius() / 1000);
  for (const item of overlays) {
    if (!isPlottable(item.lat, item.lng, item.radiusKm)) continue;
    bounds.extend(circleBounds(L, item.lat, item.lng, item.radiusKm));
  }
  map.fitBounds(bounds, {
    padding: [48, 48],
    maxZoom: overlays.length > 0 ? 16 : 18,
    animate: false,
  });
}

function paintDraft(
  L: typeof import("leaflet"),
  map: LeafletMap,
  draft: Draft | null,
  draftCircleRef: { current: LeafletCircle | null },
  lastPinRef: { current: { lat: number; lng: number } | null },
  fitTimerRef: { current: number | null },
  overlays: OverlayCircle[],
) {
  if (!draft || !isPlottable(draft.latitude, draft.longitude, draft.radiusKm)) {
    draftCircleRef.current?.remove();
    draftCircleRef.current = null;
    lastPinRef.current = null;
    return;
  }

  const pinMoved =
    lastPinRef.current == null ||
    lastPinRef.current.lat !== draft.latitude ||
    lastPinRef.current.lng !== draft.longitude;
  lastPinRef.current = { lat: draft.latitude, lng: draft.longitude };

  if (!draftCircleRef.current) {
    draftCircleRef.current = L.circle([draft.latitude, draft.longitude], {
      radius: draft.radiusKm * 1000,
      color: "#16a34a",
      weight: 2,
      fillOpacity: 0.18,
    }).addTo(map);
  } else {
    draftCircleRef.current.setLatLng([draft.latitude, draft.longitude]);
    draftCircleRef.current.setRadius(draft.radiusKm * 1000);
  }

  const hasAssigned = overlays.some((item) =>
    isPlottable(item.lat, item.lng, item.radiusKm),
  );

  if (pinMoved && !hasAssigned) {
    map.setView([draft.latitude, draft.longitude], STREET_ZOOM);
    return;
  }

  if (fitTimerRef.current) window.clearTimeout(fitTimerRef.current);
  fitTimerRef.current = window.setTimeout(() => {
    const circle = draftCircleRef.current;
    if (!circle) return;
    fitDraftInContext(L, map, circle, overlays);
  }, 80);
}

export function AgentCoverageZonesControl({
  agentId,
  agentName,
  initialZones,
}: Props) {
  const router = useRouter();
  const [zones, setZones] = useState(initialZones);
  const [pins, setPins] = useState<PinCircle[]>([]);
  const [otherZones, setOtherZones] = useState<CoverageZoneRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [collisions, setCollisions] = useState<CoverageCollision[] | null>(null);
  const [peerPriority, setPeerPriority] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mapHandleRef = useRef<CoverageMapHandle | null>(null);
  const draftRadiusRef = useRef(START_RADIUS_KM);

  const hasZones = zones.length > 0;

  const ownPin = useMemo(
    () => pins.find((pin) => pin.agent_id === agentId) ?? null,
    [agentId, pins],
  );

  const mapCenter = useMemo(() => {
    if (ownPin) return { lat: ownPin.latitude, lng: ownPin.longitude };
    const firstZone = zones[0];
    if (firstZone) return { lat: firstZone.latitude, lng: firstZone.longitude };
    return null;
  }, [ownPin, zones]);

  const isDrawing = draft != null;
  const editingPin = draft?.kind === "pin";
  const editingZoneId = draft?.kind === "zone" ? draft.zoneId : null;
  const overlayCircles = useMemo(() => {
    const own = [
      ...(ownPin && zones.length === 0 && !editingPin
        ? [
            {
              key: `own-pin-${ownPin.agent_id}`,
              lat: ownPin.latitude,
              lng: ownPin.longitude,
              radiusKm: ownPin.radius_km,
              color: "#4f46e5",
              selectable: true,
            },
          ]
        : []),
      ...zones
        .filter((zone) => zone.id !== editingZoneId)
        .map((zone) => ({
          key: `own-${zone.id}`,
          lat: zone.latitude,
          lng: zone.longitude,
          radiusKm: zone.radius_km,
          color: "#4f46e5",
          selectable: true,
        })),
    ];
    if (isDrawing) return own;
    return [
      ...otherZones.map((zone) => ({
        key: `zone-${zone.id}`,
        lat: zone.latitude,
        lng: zone.longitude,
        radiusKm: zone.radius_km,
        color: "#f59e0b",
      })),
      ...own,
    ];
  }, [editingPin, editingZoneId, isDrawing, otherZones, ownPin, zones]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/admin/coverage-map");
      const data = (await res.json()) as {
        zones?: CoverageZoneRow[];
        pins?: PinCircle[];
      };
      if (cancelled) return;
      setOtherZones((data.zones ?? []).filter((z) => z.agent_id !== agentId));
      setPins(data.pins ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, zones.length]);

  const peerPayload = (collisions ?? []).map((hit) => ({
    kind: hit.kind,
    agentId: hit.agentId,
    zoneId: hit.zoneId,
    priority: Number(peerPriority[`${hit.kind}:${hit.agentId}:${hit.zoneId ?? "pin"}`] ?? hit.currentPriority),
  }));

  const beginDraft = (next: Draft) => {
    draftRadiusRef.current = next.radiusKm;
    setCollisions(null);
    setDraft(next);
  };

  const moveDraft = (partial: Pick<Draft, "name" | "placeId" | "formattedAddress" | "latitude" | "longitude">) => {
    if (draft?.kind === "zone" || draft?.kind === "pin") {
      const radiusKm = draftRadiusRef.current;
      setCollisions(null);
      setDraft({
        ...draft,
        ...partial,
        radiusKm,
      });
      return;
    }
    const radiusKm = draft?.kind === "new" ? draftRadiusRef.current : START_RADIUS_KM;
    beginDraft({
      kind: "new",
      zoneId: null,
      name: partial.name,
      placeId: partial.placeId,
      formattedAddress: partial.formattedAddress,
      latitude: partial.latitude,
      longitude: partial.longitude,
      radiusKm,
      priority: DISPATCH_DEFAULTS.pinCoveragePriority,
    });
  };

  const startEditZone = (zone: CoverageZoneRow) => {
    beginDraft({
      kind: "zone",
      zoneId: zone.id,
      name: zone.name || "Zone",
      placeId: zone.place_id,
      formattedAddress: zone.formatted_address,
      latitude: zone.latitude,
      longitude: zone.longitude,
      radiusKm: zone.radius_km,
      priority: zone.priority,
    });
  };

  const startEditPin = (pin: PinCircle) => {
    beginDraft({
      kind: "pin",
      zoneId: null,
      name: pin.name || "Working pin",
      placeId: null,
      formattedAddress: null,
      latitude: pin.latitude,
      longitude: pin.longitude,
      radiusKm: pin.radius_km,
      priority: pin.priority,
    });
  };

  const saveDraft = useCallback(
    async (confirmCollisions: boolean) => {
      if (!draft) return;
      setSaving(true);
      setMessage(null);
      try {
        const payload = {
          name: draft.name,
          placeId: draft.placeId,
          formattedAddress: draft.formattedAddress,
          latitude: draft.latitude,
          longitude: draft.longitude,
          radius_km: draftRadiusRef.current,
          priority: draft.priority,
          confirmCollisions,
          peerUpdates: peerPayload,
        };
        const url =
          draft.kind === "pin"
            ? `/api/admin/agents/${agentId}/pin-coverage`
            : draft.kind === "zone" && draft.zoneId
              ? `/api/admin/agents/${agentId}/coverage-zones/${draft.zoneId}`
              : `/api/admin/agents/${agentId}/coverage-zones`;
        const res = await fetch(url, {
          method: draft.kind === "new" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as {
          error?: string;
          collisions?: CoverageCollision[];
          zone?: CoverageZoneRow;
          pin?: PinCircle;
        };
        if (res.status === 409 && data.collisions) {
          setCollisions(data.collisions);
          setPeerPriority(
            Object.fromEntries(
              data.collisions.map((hit) => [
                `${hit.kind}:${hit.agentId}:${hit.zoneId ?? "pin"}`,
                String(hit.currentPriority),
              ]),
            ),
          );
          setMessage(data.error ?? "Overlap found. Set priorities, then save again.");
          return;
        }
        if (!res.ok) throw new Error(data.error ?? "Failed to save");
        if (draft.kind === "pin" && data.pin) {
          setPins((current) => {
            const next = current.filter((pin) => pin.agent_id !== agentId);
            return [...next, { ...data.pin!, agent_name: agentName }];
          });
        } else if (data.zone) {
          setZones((current) => {
            const row = { ...data.zone!, agent_name: agentName };
            if (draft.kind === "zone") {
              return current.map((zone) => (zone.id === row.id ? row : zone));
            }
            return [...current, row];
          });
        }
        draftRadiusRef.current = START_RADIUS_KM;
        setDraft(null);
        setCollisions(null);
        setMessage(
          draft.kind === "pin"
            ? "Working pin updated."
            : draft.kind === "zone"
              ? "Zone updated."
              : "Zone saved. This agent now matches by zones, not the working-pin radius.",
        );
        router.refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [agentId, agentName, draft, peerPayload, router],
  );

  const removeZone = async (zoneId: string) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/coverage-zones/${zoneId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete zone");
      setZones((current) => current.filter((zone) => zone.id !== zoneId));
      if (draft?.zoneId === zoneId) {
        draftRadiusRef.current = START_RADIUS_KM;
        setDraft(null);
      }
      setMessage(
        zones.length <= 1
          ? "All zones removed. This agent is back on working-pin + radius."
          : "Zone removed.",
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to delete zone");
    } finally {
      setSaving(false);
    }
  };

  const removePin = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/working-place`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete working pin");
      setPins((current) => current.filter((pin) => pin.agent_id !== agentId));
      if (draft?.kind === "pin") {
        draftRadiusRef.current = START_RADIUS_KM;
        setDraft(null);
      }
      setMessage("Working pin removed. This agent will not match by pin until you set one again.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to delete working pin");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm xl:p-5">
      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Coverage zones
      </Label>
      <p className="mt-1 text-sm text-gray-600">
        {hasZones
          ? "Dashed indigo circles stay. Search or tap the map to add another zone — that will not replace the ones already saved. Use Adjust in the list to change an existing zone."
          : "The working pin is a coverage circle like any other. Search or tap the map to add a zone. Use Adjust to change the pin."}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <CoverageMapCanvas
          ref={mapHandleRef}
          overlays={overlayCircles}
          draft={draft}
          initialCenter={mapCenter}
          className="h-[62vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-gray-200 xl:h-[min(80vh,960px)]"
          onDrop={(latitude, longitude) => {
            moveDraft({
              name: draft?.kind === "zone" || draft?.kind === "pin" ? draft.name : "Dropped pin",
              placeId: draft?.kind === "zone" || draft?.kind === "pin" ? draft.placeId : null,
              formattedAddress:
                draft?.kind === "zone" || draft?.kind === "pin" ? draft.formattedAddress : null,
              latitude,
              longitude,
            });
          }}
        />

        <aside className="flex min-h-0 flex-col gap-3 xl:max-h-[min(80vh,960px)] xl:overflow-y-auto">
          <AdminPlacesSearch
            disabled={saving}
            onSelect={(place) => {
              moveDraft({
                name: place.name,
                placeId: place.placeId,
                formattedAddress: place.formattedAddress,
                latitude: place.lat,
                longitude: place.lng,
              });
            }}
          />

          {draft ? (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-sm font-medium text-gray-900">
                {draft.kind === "pin"
                  ? `Adjust working pin · ${draft.name}`
                  : draft.kind === "zone"
                    ? `Adjust zone · ${draft.name}`
                    : draft.name}
              </p>
              <RadiusSlider
                value={draft.radiusKm}
                disabled={saving}
                onLive={(km) => {
                  draftRadiusRef.current = km;
                  mapHandleRef.current?.setDraftRadius(km);
                }}
                onCommit={(km) => {
                  draftRadiusRef.current = km;
                  setDraft((current) => (current ? { ...current, radiusKm: km } : current));
                }}
              />
              <div className="space-y-1">
                <Label htmlFor="zone-priority" className="text-xs text-gray-500">
                  Priority (1 wins)
                </Label>
                <Input
                  id="zone-priority"
                  type="number"
                  min={1}
                  max={1000}
                  className="w-24"
                  value={draft.priority}
                  disabled={saving}
                  onChange={(e) =>
                    setDraft({ ...draft, priority: Number(e.target.value) || 1 })
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={saving} onClick={() => void saveDraft(false)}>
                  {saving ? "Saving…" : draft.kind === "new" ? "Save zone" : "Save changes"}
                </Button>
                {draft.kind === "zone" && draft.zoneId ? (
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void removeZone(draft.zoneId!)}>
                    Delete
                  </Button>
                ) : null}
                {draft.kind === "pin" ? (
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void removePin()}>
                    Delete
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    draftRadiusRef.current = START_RADIUS_KM;
                    setDraft(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {collisions && collisions.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-950">
                Overlap with {collisions.length} other coverage area{collisions.length === 1 ? "" : "s"}. Set who wins, then confirm.
              </p>
              {collisions.map((hit) => {
                const key = `${hit.kind}:${hit.agentId}:${hit.zoneId ?? "pin"}`;
                return (
                  <div key={key} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 text-gray-800">
                      {hit.agentName} · {hit.label} · {hit.radiusKm} km
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      className="w-20"
                      value={peerPriority[key] ?? String(hit.currentPriority)}
                      onChange={(e) =>
                        setPeerPriority((current) => ({ ...current, [key]: e.target.value }))
                      }
                    />
                  </div>
                );
              })}
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => void saveDraft(true)}
              >
                Confirm priorities and save
              </Button>
            </div>
          ) : null}

          {ownPin || zones.length > 0 ? (
            <ul className="space-y-2">
              {ownPin && zones.length === 0 ? (
                <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-gray-900">{ownPin.name || "Working pin"}</span>
                    <span className="text-gray-500">
                      {" "}
                      · {ownPin.radius_km} km · priority {ownPin.priority}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => startEditPin(ownPin)}
                    >
                      Adjust
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => void removePin()}
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              ) : null}
              {zones.map((zone) => (
                <li
                  key={zone.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium text-gray-900">{zone.name || "Zone"}</span>
                    <span className="text-gray-500">
                      {" "}
                      · {zone.radius_km} km · priority {zone.priority}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => startEditZone(zone)}
                    >
                      Adjust
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => void removeZone(zone.id)}
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {message ? <p className="text-sm text-gray-600">{message}</p> : null}
        </aside>
      </div>
    </div>
  );
}
