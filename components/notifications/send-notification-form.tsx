"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { Bell, Loader2, Trash2, Upload } from "lucide-react";

type TargetKind = "one" | "multiple" | "all";
type AnnouncementKind = "announcement" | "meeting" | "urgent";

type AgentOption = {
  id: string;
  name: string | null;
  email: string | null;
};

interface SendNotificationFormProps {
  agents: AgentOption[];
  /** Pre-select this agent (e.g. from agent profile link). */
  initialAgentId?: string | null;
  /** Called after a successful send (refresh active spotlights). */
  onSent?: () => void;
}

const ACCENT_PRESETS = [
  { label: "Blue", value: "#2F80ED" },
  { label: "Orange", value: "#E67E22" },
  { label: "Red", value: "#E60012" },
  { label: "Green", value: "#00A651" },
  { label: "Slate", value: "#334155" },
  { label: "Purple", value: "#6A1B9A" },
] as const;

const PLATFORM_ICON_OPTIONS = [
  { value: "", label: "Auto (from label / link)" },
  { value: "videocam", label: "Video / Teams" },
  { value: "chat", label: "Chat / WhatsApp" },
  { value: "link", label: "Link" },
  { value: "language", label: "Website" },
  { value: "phone", label: "Phone" },
  { value: "groups", label: "People / Group" },
  { value: "assignment", label: "Task" },
  { value: "campaign", label: "Announcement" },
  { value: "place", label: "Location" },
  { value: "notifications", label: "Alert" },
] as const;

function normalizeAccent(raw: string): string | null {
  const value = raw.trim();
  const match = value.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${hex.toUpperCase()}`;
}

const NOTIFICATION_TYPE = "SYSTEM_ANNOUNCEMENT";

const KIND_OPTIONS: { value: AnnouncementKind; label: string; hint: string }[] = [
  {
    value: "announcement",
    label: "Announcement",
    hint: "Bell + notifications list",
  },
  {
    value: "meeting",
    label: "Meeting",
    hint: "Home spotlight + custom CTA",
  },
  {
    value: "urgent",
    label: "Urgent",
    hint: "Home spotlight, stronger emphasis",
  },
];

export function SendNotificationForm({
  agents,
  initialAgentId,
  onSent,
}: SendNotificationFormProps) {
  const [targetKind, setTargetKind] = useState<TargetKind>("one");
  const [selectedOne, setSelectedOne] = useState<string>(initialAgentId ?? "");
  useEffect(() => {
    if (initialAgentId && agents.some((a) => a.id === initialAgentId)) {
      setTargetKind("one");
      setSelectedOne(initialAgentId);
    }
  }, [initialAgentId, agents]);
  const [selectedMultiple, setSelectedMultiple] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<AnnouncementKind>("announcement");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [platformLabel, setPlatformLabel] = useState("");
  const [platformIcon, setPlatformIcon] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; count: number; error?: string } | null>(null);

  const toggleMultiple = (id: string) => {
    setSelectedMultiple((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllMultiple = () => {
    if (selectedMultiple.size === agents.length) setSelectedMultiple(new Set());
    else setSelectedMultiple(new Set(agents.map((a) => a.id)));
  };

  const getRecipientIds = (): string[] => {
    if (targetKind === "all") return agents.map((a) => a.id);
    if (targetKind === "one") return selectedOne ? [selectedOne] : [];
    return Array.from(selectedMultiple);
  };

  const uploadLogo = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setResult({ ok: false, count: 0, error: "Logo must be PNG, JPEG, or WebP." });
      return;
    }
    if (file.size > 512 * 1024) {
      setResult({ ok: false, count: 0, error: "Logo must be under 512 KB." });
      return;
    }

    setUploadingLogo(true);
    setResult(null);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `announcement-logos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("wam-notification-assets")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("wam-notification-assets")
        .getPublicUrl(path);
      setLogoUrl(data.publicUrl);
    } catch (err) {
      setResult({
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : "Logo upload failed.",
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ids = getRecipientIds();
    if (!title.trim() || !message.trim()) {
      setResult({ ok: false, count: 0, error: "Title and message are required." });
      return;
    }
    if (ids.length === 0) {
      setResult({ ok: false, count: 0, error: "Select at least one agent." });
      return;
    }

    setSending(true);
    setResult(null);

    const normalizedAccent = accentColor.trim()
      ? normalizeAccent(accentColor)
      : null;
    if (accentColor.trim() && !normalizedAccent) {
      setResult({
        ok: false,
        count: 0,
        error: "Accent color must be a hex value like #2F80ED.",
      });
      setSending(false);
      return;
    }

    const trimmedUrl = actionUrl.trim();
    if (trimmedUrl) {
      try {
        const parsed = new URL(trimmedUrl);
        const ok =
          parsed.protocol === "http:" ||
          parsed.protocol === "https:" ||
          parsed.protocol === "whatsapp:" ||
          parsed.protocol === "msteams:";
        if (!ok) {
          setResult({
            ok: false,
            count: 0,
            error: "Link must be https, WhatsApp, or Teams.",
          });
          setSending(false);
          return;
        }
      } catch {
        setResult({ ok: false, count: 0, error: "Enter a valid link URL." });
        setSending(false);
        return;
      }
    }

    try {
      const supabase = createClient();
      const blastId =
        kind === "meeting" || kind === "urgent"
          ? crypto.randomUUID()
          : null;
      const rows = ids.map((agent_id) => ({
        agent_id,
        type: NOTIFICATION_TYPE,
        title: title.trim(),
        message: message.trim(),
        metadata: {
          source: "admin_dashboard",
          custom: true,
          kind,
          ...(blastId ? { blastId } : {}),
          ...(trimmedUrl ? { actionUrl: trimmedUrl } : {}),
          ...(logoUrl.trim() ? { logoUrl: logoUrl.trim() } : {}),
          ...(platformLabel.trim() ? { platformLabel: platformLabel.trim() } : {}),
          ...(platformIcon.trim() ? { platformIcon: platformIcon.trim() } : {}),
          ...(ctaLabel.trim() ? { ctaLabel: ctaLabel.trim() } : {}),
          ...(normalizedAccent ? { accentColor: normalizedAccent } : {}),
          ...(startsAt.trim()
            ? { startsAt: new Date(startsAt).toISOString() }
            : {}),
          ...(expiresAt.trim()
            ? { expiresAt: new Date(expiresAt).toISOString() }
            : {}),
        },
      }));

      const { data, error } = await supabase.from("notifications").insert(rows).select("id");

      if (error) {
        setResult({ ok: false, count: 0, error: error.message });
        setSending(false);
        return;
      }

      setResult({ ok: true, count: data?.length ?? ids.length });
      setTitle("");
      setMessage("");
      setActionUrl("");
      setStartsAt("");
      setExpiresAt("");
      setPlatformLabel("");
      setPlatformIcon("");
      setCtaLabel("");
      setAccentColor("");
      setLogoUrl("");
      setKind("announcement");
      setSelectedOne("");
      setSelectedMultiple(new Set());
      onSent?.();
    } catch (err) {
      setResult({ ok: false, count: 0, error: err instanceof Error ? err.message : "Failed to send." });
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-3">
        <Label className="text-sm font-semibold text-gray-700">Send to</Label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="target"
              checked={targetKind === "one"}
              onChange={() => setTargetKind("one")}
              className="rounded-full border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">One agent</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="target"
              checked={targetKind === "multiple"}
              onChange={() => setTargetKind("multiple")}
              className="rounded-full border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">Multiple agents</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="target"
              checked={targetKind === "all"}
              onChange={() => setTargetKind("all")}
              className="rounded-full border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">All agents</span>
          </label>
        </div>
      </div>

      {targetKind === "one" && (
        <div className="space-y-2">
          <Label htmlFor="agent-one" className="text-sm text-gray-700">Select agent</Label>
          <select
            id="agent-one"
            value={selectedOne}
            onChange={(e) => setSelectedOne(e.target.value)}
            className="w-full max-w-md rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Choose an agent…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.email || a.id.slice(0, 8)} {a.email ? `(${a.email})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {targetKind === "multiple" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-gray-700">Select agents</Label>
            <button
              type="button"
              onClick={selectAllMultiple}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              {selectedMultiple.size === agents.length ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white p-2">
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedMultiple.has(a.id)}
                  onChange={() => toggleMultiple(a.id)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-800 truncate">
                  {a.name || a.email || a.id.slice(0, 8)} {a.email ? `(${a.email})` : ""}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500">{selectedMultiple.size} selected</p>
        </div>
      )}

      {targetKind === "all" && (
        <p className="text-sm text-gray-600 rounded-md bg-gray-50 px-3 py-2">
          All {agents.length} agents will receive this notification.
        </p>
      )}

      <div className="space-y-2">
        <Label className="text-sm font-semibold text-gray-700">Type</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {KIND_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`cursor-pointer rounded-md border px-3 py-2 ${
                kind === option.value
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
            >
              <input
                type="radio"
                name="kind"
                className="sr-only"
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
              />
              <span className="block text-sm font-medium text-gray-900">{option.label}</span>
              <span className="block text-xs text-gray-500">{option.hint}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title" className="text-sm font-semibold text-gray-700">Title</Label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "meeting" ? "e.g. Weekly agent briefing" : "e.g. System maintenance"}
          maxLength={200}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="message" className="text-sm font-semibold text-gray-700">Message</Label>
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Write your notification message…"
          rows={4}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y min-h-[100px]"
        />
      </div>

      {(kind === "meeting" || kind === "urgent") && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="starts-at" className="text-sm font-semibold text-gray-700">
              When (optional)
            </Label>
            <input
              id="starts-at"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expires-at" className="text-sm font-semibold text-gray-700">
              Expires (optional)
            </Label>
            <input
              id="expires-at"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-500">
              After this time the home card hides automatically.
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="platform" className="text-sm font-semibold text-gray-700">
              Platform label (optional)
            </Label>
            <input
              id="platform"
              type="text"
              value={platformLabel}
              onChange={(e) => setPlatformLabel(e.target.value)}
              placeholder="e.g. Microsoft Teams, WhatsApp"
              maxLength={80}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-icon" className="text-sm font-semibold text-gray-700">
              Platform icon
            </Label>
            <select
              id="platform-icon"
              value={platformIcon}
              onChange={(e) => setPlatformIcon(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {PLATFORM_ICON_OPTIONS.map((opt) => (
                <option key={opt.value || "auto"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500">
              Shown next to the platform label and on the home card button.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cta-label" className="text-sm font-semibold text-gray-700">
              Button label (optional)
            </Label>
            <input
              id="cta-label"
              type="text"
              value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)}
              placeholder={
                kind === "urgent"
                  ? "e.g. Open, Got it"
                  : "e.g. Join now, Open WhatsApp"
              }
              maxLength={40}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-500">
              Leave empty for the default ({kind === "urgent" ? "Open / Got it" : "Join now / View details"}).
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-sm font-semibold text-gray-700">
              Accent color (optional)
            </Label>
            <p className="text-xs text-gray-500">
              Colors the home card bar, button, and accents. Leave empty for the default Meeting / Urgent theme.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="color"
                aria-label="Accent color picker"
                value={normalizeAccent(accentColor) ?? "#2F80ED"}
                onChange={(e) => setAccentColor(e.target.value.toUpperCase())}
                className="h-10 w-12 cursor-pointer rounded border border-gray-300 bg-white p-1"
              />
              <input
                type="text"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                placeholder="Default theme"
                maxLength={7}
                className="w-36 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {normalizeAccent(accentColor) ? (
                <span
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700"
                >
                  <span
                    className="h-4 w-4 rounded"
                    style={{ backgroundColor: normalizeAccent(accentColor)! }}
                  />
                  Preview · {normalizeAccent(accentColor)}
                </span>
              ) : (
                <span className="text-xs text-gray-500">Using default theme</span>
              )}
              {accentColor ? (
                <button
                  type="button"
                  onClick={() => setAccentColor("")}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  Use default
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  title={preset.label}
                  onClick={() => setAccentColor(preset.value)}
                  className={`h-7 w-7 rounded-full border-2 ${
                    normalizeAccent(accentColor) === preset.value
                      ? "border-gray-900"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: preset.value }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="action-url" className="text-sm font-semibold text-gray-700">
          Link (optional)
        </Label>
        <input
          id="action-url"
          type="url"
          value={actionUrl}
          onChange={(e) => setActionUrl(e.target.value)}
          placeholder="https://teams.microsoft.com/... or https://wa.me/2547..."
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="text-xs text-gray-500">
          Agents can open this from the push, Notifications tab, and home spotlight button.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-semibold text-gray-700">
          Logo (optional)
        </Label>
        <p className="text-xs text-gray-500">
          Upload a Teams / WhatsApp / custom logo for the home card watermark. PNG or WebP under 512 KB works best.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            {uploadingLogo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploadingLogo ? "Uploading…" : "Upload logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={uploadingLogo}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadLogo(file);
                e.target.value = "";
              }}
            />
          </label>
          {logoUrl ? (
            <button
              type="button"
              onClick={() => setLogoUrl("")}
              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          ) : null}
        </div>
        {logoUrl ? (
          <div className="mt-2 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 p-3">
            <Image
              src={logoUrl}
              alt="Logo preview"
              width={56}
              height={56}
              className="h-14 w-14 rounded-md object-contain bg-white"
              unoptimized
            />
            <p className="text-xs text-gray-500 break-all">{logoUrl}</p>
          </div>
        ) : null}
      </div>

      {result && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            result.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {result.ok
            ? `Notification sent to ${result.count} agent${result.count === 1 ? "" : "s"}.`
            : result.error}
        </div>
      )}

      <Button type="submit" disabled={sending || uploadingLogo} className="gap-2">
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Bell className="h-4 w-4" />
            Send notification
          </>
        )}
      </Button>
    </form>
  );
}
