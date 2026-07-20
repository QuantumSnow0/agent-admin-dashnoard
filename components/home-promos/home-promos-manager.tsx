"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  HOME_PROMO_CTA_OPTIONS,
  isHomePromoCtaAction,
  type HomePromo,
  type HomePromoCtaAction,
} from "@/lib/home-promos";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

type Draft = {
  id?: string;
  title: string;
  subtitle: string;
  image_url: string;
  cta_label: string;
  cta_action: HomePromoCtaAction;
  sort_order: number;
  is_active: boolean;
};

const emptyDraft = (): Draft => ({
  title: "",
  subtitle: "",
  image_url: "",
  cta_label: "Onboard",
  cta_action: "register_safaricom",
  sort_order: 0,
  is_active: true,
});

function toDraft(row: HomePromo): Draft {
  return {
    id: row.id,
    title: row.title ?? "",
    subtitle: row.subtitle ?? "",
    image_url: row.image_url,
    cta_label: row.cta_label,
    cta_action: row.cta_action,
    sort_order: row.sort_order,
    is_active: row.is_active,
  };
}

export function HomePromosManager({
  initialPromos,
}: {
  initialPromos: HomePromo[];
}) {
  const [promos, setPromos] = useState(initialPromos);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...promos].sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.created_at.localeCompare(b.created_at),
      ),
    [promos],
  );

  const openCreate = () => {
    setError(null);
    setMessage(null);
    setDraft({
      ...emptyDraft(),
      sort_order: promos.length,
    });
  };

  const openEdit = (row: HomePromo) => {
    setError(null);
    setMessage(null);
    setDraft(toDraft(row));
  };

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError("Image must be under 3 MB.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `slides/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("home-promos")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("home-promos").getPublicUrl(path);
      setDraft((prev) =>
        prev ? { ...prev, image_url: data.publicUrl } : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.image_url.trim()) {
      setError("Upload an image first.");
      return;
    }
    if (!draft.cta_label.trim()) {
      setError("CTA label is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const payload = {
        title: draft.title.trim() || null,
        subtitle: draft.subtitle.trim() || null,
        image_url: draft.image_url.trim(),
        cta_label: draft.cta_label.trim(),
        cta_action: draft.cta_action,
        sort_order: Number.isFinite(draft.sort_order) ? draft.sort_order : 0,
        is_active: draft.is_active,
        updated_at: new Date().toISOString(),
      };

      if (draft.id) {
        const { data, error: updateError } = await supabase
          .from("home_promos")
          .update(payload)
          .eq("id", draft.id)
          .select("*")
          .single();
        if (updateError) throw updateError;
        setPromos((prev) =>
          prev.map((p) => (p.id === data.id ? (data as HomePromo) : p)),
        );
        setMessage("Promo updated.");
      } else {
        const { data, error: insertError } = await supabase
          .from("home_promos")
          .insert(payload)
          .select("*")
          .single();
        if (insertError) throw insertError;
        setPromos((prev) => [...prev, data as HomePromo]);
        setMessage("Promo created.");
      }
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const removePromo = async (id: string) => {
    if (!window.confirm("Delete this promo slide?")) return;
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from("home_promos")
        .delete()
        .eq("id", id);
      if (deleteError) throw deleteError;
      setPromos((prev) => prev.filter((p) => p.id !== id));
      setMessage("Promo deleted.");
      if (draft?.id === id) setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  const toggleActive = async (row: HomePromo) => {
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: updateError } = await supabase
        .from("home_promos")
        .update({
          is_active: !row.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      setPromos((prev) =>
        prev.map((p) => (p.id === data.id ? (data as HomePromo) : p)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update status.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          Active slides appear on the agent Home carousel. If none are active,
          the app falls back to built-in images.
        </p>
        <Button type="button" onClick={openCreate} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          Add slide
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      {draft ? (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-gray-900">
            {draft.id ? "Edit slide" : "New slide"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="promo-title">Title</Label>
              <Input
                id="promo-title"
                value={draft.title}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, title: e.target.value } : prev,
                  )
                }
                placeholder="Grow with Safaricom"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-cta-label">CTA label</Label>
              <Input
                id="promo-cta-label"
                value={draft.cta_label}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, cta_label: e.target.value } : prev,
                  )
                }
                placeholder="Onboard"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="promo-subtitle">Subtitle</Label>
            <Input
              id="promo-subtitle"
              value={draft.subtitle}
              onChange={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, subtitle: e.target.value } : prev,
                )
              }
              placeholder="Earn more when you register new customers."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="promo-cta-action">CTA action</Label>
              <select
                id="promo-cta-action"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={draft.cta_action}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!isHomePromoCtaAction(value)) return;
                  setDraft((prev) =>
                    prev ? { ...prev, cta_action: value } : prev,
                  );
                }}
              >
                {HOME_PROMO_CTA_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-sort">Sort order</Label>
              <Input
                id="promo-sort"
                type="number"
                value={draft.sort_order}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, sort_order: Number(e.target.value) || 0 }
                      : prev,
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <label className="flex h-10 items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(e) =>
                    setDraft((prev) =>
                      prev ? { ...prev, is_active: e.target.checked } : prev,
                    )
                  }
                />
                Active
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="promo-image">Image</Label>
            <Input
              id="promo-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file);
              }}
            />
            {uploading ? (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </p>
            ) : null}
            {draft.image_url ? (
              <div className="relative mt-2 h-36 w-full overflow-hidden rounded-lg bg-gray-100">
                <Image
                  src={draft.image_url}
                  alt="Promo preview"
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={() => void saveDraft()} disabled={saving || uploading}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save slide"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft(null)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {sorted.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-500">
            No promo slides yet. Add one to control the Home carousel.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sorted.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
              >
                <div className="relative h-20 w-full shrink-0 overflow-hidden rounded-lg bg-gray-100 sm:w-36">
                  <Image
                    src={row.image_url}
                    alt={row.title || "Promo"}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900 truncate">
                      {row.title || "Untitled slide"}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.is_active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {row.is_active ? "Active" : "Inactive"}
                    </span>
                    <span className="text-xs text-gray-500">
                      Order {row.sort_order}
                    </span>
                  </div>
                  {row.subtitle ? (
                    <p className="mt-0.5 text-sm text-gray-600 line-clamp-2">
                      {row.subtitle}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-gray-500">
                    CTA: {row.cta_label} →{" "}
                    {HOME_PROMO_CTA_OPTIONS.find(
                      (o) => o.value === row.cta_action,
                    )?.label ?? row.cta_action}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void toggleActive(row)}
                  >
                    {row.is_active ? "Pause" : "Activate"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(row)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void removePromo(row.id)}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
