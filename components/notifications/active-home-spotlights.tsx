"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Pencil, RefreshCw, Send, Trash2, Users } from "lucide-react";

type AgentOption = {
  id: string;
  name: string | null;
  email: string | null;
};

type SpotlightRow = {
  id: string;
  agent_id: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type Recipient = {
  agentId: string;
  label: string;
  notificationId: string;
  dismissed: boolean;
};

type SpotlightGroup = {
  key: string;
  blastId: string | null;
  title: string;
  message: string;
  kind: string;
  accentColor: string | null;
  count: number;
  activeCount: number;
  dismissedCount: number;
  ids: string[];
  activeIds: string[];
  recipientIds: string[];
  recipients: Recipient[];
  templateMeta: Record<string, unknown>;
  createdAt: string;
  expiresAt: string | null;
  startsAt: string | null;
};

type EditDraft = {
  title: string;
  message: string;
  kind: "meeting" | "urgent";
  platformLabel: string;
  platformIcon: string;
  ctaLabel: string;
  actionUrl: string;
  accentColor: string;
  startsAt: string;
  expiresAt: string;
  logoUrl: string;
};

const ACCENT_PRESETS = [
  "#2F80ED",
  "#E67E22",
  "#E60012",
  "#00A651",
  "#334155",
  "#6A1B9A",
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

function kindOf(meta: Record<string, unknown> | null): string {
  return String(meta?.kind ?? "announcement").toLowerCase();
}

function isAdminCleared(meta: Record<string, unknown> | null): boolean {
  return typeof meta?.adminClearedAt === "string" && Boolean(meta.adminClearedAt);
}

function groupKey(row: SpotlightRow): string {
  const meta = row.metadata ?? {};
  const blastId = typeof meta.blastId === "string" ? meta.blastId : "";
  if (blastId) return `blast:${blastId}`;
  return `legacy:${row.title}|${kindOf(meta)}|${row.created_at.slice(0, 16)}`;
}

function agentLabel(agent: AgentOption | undefined, fallbackId: string): string {
  if (!agent) return fallbackId.slice(0, 8);
  return agent.name || agent.email || agent.id.slice(0, 8);
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

function draftFromGroup(group: SpotlightGroup): EditDraft {
  const meta = group.templateMeta;
  return {
    title: group.title,
    message: group.message,
    kind: group.kind === "urgent" ? "urgent" : "meeting",
    platformLabel:
      typeof meta.platformLabel === "string" ? meta.platformLabel : "",
    platformIcon:
      typeof meta.platformIcon === "string" ? meta.platformIcon : "",
    ctaLabel: typeof meta.ctaLabel === "string" ? meta.ctaLabel : "",
    actionUrl:
      typeof meta.actionUrl === "string"
        ? meta.actionUrl
        : typeof meta.url === "string"
          ? meta.url
          : typeof meta.link === "string"
            ? meta.link
            : "",
    accentColor: group.accentColor ?? "",
    startsAt: toLocalInput(group.startsAt),
    expiresAt: toLocalInput(group.expiresAt),
    logoUrl: typeof meta.logoUrl === "string" ? meta.logoUrl : "",
  };
}

function buildMetadata(
  draft: EditDraft,
  base: Record<string, unknown>,
  blastId: string,
): Record<string, unknown> {
  const { adminClearedAt: _c, ...rest } = base;
  const accent = normalizeAccent(draft.accentColor);
  const meta: Record<string, unknown> = {
    ...rest,
    source: "admin_dashboard",
    custom: true,
    kind: draft.kind,
    blastId,
  };

  if (draft.actionUrl.trim()) meta.actionUrl = draft.actionUrl.trim();
  else {
    delete meta.actionUrl;
    delete meta.url;
    delete meta.link;
  }

  if ((draft.platformLabel ?? "").trim()) {
    meta.platformLabel = draft.platformLabel.trim();
  } else delete meta.platformLabel;

  if ((draft.platformIcon ?? "").trim()) {
    meta.platformIcon = draft.platformIcon.trim();
  } else delete meta.platformIcon;

  if ((draft.ctaLabel ?? "").trim()) {
    meta.ctaLabel = draft.ctaLabel.trim();
  } else delete meta.ctaLabel;

  if (draft.logoUrl.trim()) meta.logoUrl = draft.logoUrl.trim();
  else delete meta.logoUrl;

  if (accent) meta.accentColor = accent;
  else {
    delete meta.accentColor;
    delete meta.accent;
  }

  if (draft.startsAt.trim()) {
    meta.startsAt = new Date(draft.startsAt).toISOString();
  } else delete meta.startsAt;

  if (draft.expiresAt.trim()) {
    meta.expiresAt = new Date(draft.expiresAt).toISOString();
  } else delete meta.expiresAt;

  return meta;
}

async function markAdminCleared(ids: string[]) {
  const supabase = createClient();
  const clearedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("notifications")
    .select("id, metadata")
    .in("id", ids);
  if (error) throw error;

  await Promise.all(
    (data ?? []).map(async (row) => {
      const meta =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {};
      const { error: updateError } = await supabase
        .from("notifications")
        .update({
          is_read: true,
          read_at: clearedAt,
          metadata: {
            ...meta,
            adminClearedAt: clearedAt,
          },
        })
        .eq("id", row.id);
      if (updateError) throw updateError;
    }),
  );
}

export function ActiveHomeSpotlightsPanel({
  agents,
  refreshToken = 0,
}: {
  agents: AgentOption[];
  refreshToken?: number;
}) {
  const [rows, setRows] = useState<SpotlightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearingKey, setClearingKey] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [sendSelected, setSendSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const agentById = useMemo(() => {
    const map = new Map<string, AgentOption>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("notifications")
        .select("id, agent_id, title, message, is_read, created_at, metadata")
        .eq("type", "SYSTEM_ANNOUNCEMENT")
        .order("created_at", { ascending: false })
        .limit(800);

      if (fetchError) throw fetchError;

      const spotlight = ((data ?? []) as SpotlightRow[]).filter((row) => {
        const kind = kindOf(row.metadata);
        if (kind !== "meeting" && kind !== "urgent") return false;
        if (isAdminCleared(row.metadata)) return false;
        return true;
      });
      setRows(spotlight);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load spotlights.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const groups = useMemo(() => {
    const map = new Map<string, SpotlightGroup>();
    for (const row of rows) {
      const meta = row.metadata ?? {};
      const key = groupKey(row);
      const existing = map.get(key);
      const recipient: Recipient = {
        agentId: row.agent_id,
        label: agentLabel(agentById.get(row.agent_id), row.agent_id),
        notificationId: row.id,
        dismissed: Boolean(row.is_read),
      };
      const accent =
        typeof meta.accentColor === "string"
          ? meta.accentColor
          : typeof meta.accent === "string"
            ? meta.accent
            : null;

      if (existing) {
        existing.count += 1;
        existing.ids.push(row.id);
        existing.recipientIds.push(row.agent_id);
        existing.recipients.push(recipient);
        if (row.is_read) existing.dismissedCount += 1;
        else {
          existing.activeCount += 1;
          existing.activeIds.push(row.id);
        }
        continue;
      }
      map.set(key, {
        key,
        blastId: typeof meta.blastId === "string" ? meta.blastId : null,
        title: row.title,
        message: row.message,
        kind: kindOf(meta),
        accentColor: accent,
        count: 1,
        activeCount: row.is_read ? 0 : 1,
        dismissedCount: row.is_read ? 1 : 0,
        ids: [row.id],
        activeIds: row.is_read ? [] : [row.id],
        recipientIds: [row.agent_id],
        recipients: [recipient],
        templateMeta: { ...meta },
        createdAt: row.created_at,
        expiresAt: typeof meta.expiresAt === "string" ? meta.expiresAt : null,
        startsAt: typeof meta.startsAt === "string" ? meta.startsAt : null,
      });
    }
    return Array.from(map.values()).map((g) => ({
      ...g,
      recipients: [...g.recipients].sort((a, b) => {
        if (a.dismissed !== b.dismissed) return a.dismissed ? 1 : -1;
        return a.label.localeCompare(b.label);
      }),
    }));
  }, [rows, agentById]);

  const clearIds = async (ids: string[], key: string | "all") => {
    if (ids.length === 0) return;
    if (key === "all") setClearingAll(true);
    else setClearingKey(key);
    setError(null);
    setMessage(null);
    try {
      await markAdminCleared(ids);
      setMessage(
        key === "all"
          ? `Cleared ${ids.length} home spotlight notification${ids.length === 1 ? "" : "s"} from admin.`
          : `Cleared this send for ${ids.length} agent${ids.length === 1 ? "" : "s"}.`,
      );
      if (editKey === key) {
        setEditKey(null);
        setDraft(null);
        setSendSelected(new Set());
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed.");
    } finally {
      setClearingKey(null);
      setClearingAll(false);
    }
  };

  const openEdit = (group: SpotlightGroup) => {
    setError(null);
    setMessage(null);
    setEditKey(group.key);
    setDraft(draftFromGroup(group));
    // Pre-select everyone who already received it (on home + dismissed)
    setSendSelected(new Set(group.recipientIds));
    setExpandedKey(group.key);
  };

  const closeEdit = () => {
    setEditKey(null);
    setDraft(null);
    setSendSelected(new Set());
  };

  const toggleSendAgent = (id: string) => {
    setSendSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const validateDraft = (): string | null => {
    if (!draft) return "Nothing to save.";
    if (!draft.title.trim() || !draft.message.trim()) {
      return "Title and message are required.";
    }
    if (draft.accentColor.trim() && !normalizeAccent(draft.accentColor)) {
      return "Accent color must be a hex value like #2F80ED.";
    }
    if (draft.actionUrl.trim()) {
      try {
        const parsed = new URL(draft.actionUrl.trim());
        const ok =
          parsed.protocol === "http:" ||
          parsed.protocol === "https:" ||
          parsed.protocol === "whatsapp:" ||
          parsed.protocol === "msteams:";
        if (!ok) return "Link must be https, WhatsApp, or Teams.";
      } catch {
        return "Enter a valid link URL.";
      }
    }
    return null;
  };

  /** Apply edited content to any selected agents — on home, dismissed, or new. */
  const applyToSelected = async (group: SpotlightGroup) => {
    const validationError = validateDraft();
    if (validationError || !draft) {
      setError(validationError ?? "Nothing to save.");
      return;
    }

    const selected = Array.from(sendSelected);
    if (selected.length === 0) {
      setError("Select at least one agent.");
      return;
    }

    const existingByAgent = new Map(
      group.recipients.map((r) => [r.agentId, r] as const),
    );

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      const blastId = group.blastId || crypto.randomUUID();
      const metadata = buildMetadata(draft, group.templateMeta, blastId);

      let updatedOnHome = 0;
      let reopened = 0;
      let inserted = 0;

      const toInsert: string[] = [];

      await Promise.all(
        selected.map(async (agentId) => {
          const existing = existingByAgent.get(agentId);
          if (!existing) {
            toInsert.push(agentId);
            return;
          }

          const { error: updateError } = await supabase
            .from("notifications")
            .update({
              title: draft.title.trim(),
              message: draft.message.trim(),
              is_read: false,
              read_at: null,
              metadata,
            })
            .eq("id", existing.notificationId);
          if (updateError) throw updateError;

          if (existing.dismissed) reopened += 1;
          else updatedOnHome += 1;
        }),
      );

      if (toInsert.length > 0) {
        const insertRows = toInsert.map((agent_id) => ({
          agent_id,
          type: "SYSTEM_ANNOUNCEMENT",
          title: draft.title.trim(),
          message: draft.message.trim(),
          metadata,
        }));
        const { error: insertError } = await supabase
          .from("notifications")
          .insert(insertRows);
        if (insertError) throw insertError;
        inserted = toInsert.length;
      }

      const parts: string[] = [];
      if (updatedOnHome > 0) {
        parts.push(
          `updated ${updatedOnHome} on home`,
        );
      }
      if (reopened > 0) {
        parts.push(
          `re-opened ${reopened} dismissed`,
        );
      }
      if (inserted > 0) {
        parts.push(
          `sent to ${inserted} new`,
        );
      }
      setMessage(parts.join(" · ") || "Saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const allIds = groups.flatMap((g) => g.ids);

  const formatRecipientSummary = (group: SpotlightGroup) => {
    const active = group.recipients.filter((r) => !r.dismissed).map((r) => r.label);
    const names = active.length > 0 ? active : group.recipients.map((r) => r.label);
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Active home spotlights
          </h2>
          <p className="text-sm text-gray-600">
            Edit content, send to more agents, or clear. Agent dismiss only hides it on their phone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={clearingAll || allIds.length === 0}
            onClick={() => void clearIds(allIds, "all")}
            className="gap-1.5 text-red-700 border-red-200 hover:bg-red-50"
          >
            {clearingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Clear all
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {message}
        </p>
      ) : null}

      {loading && groups.length === 0 ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
          No active meeting or urgent home cards.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {groups.map((group) => {
            const expired =
              group.expiresAt != null &&
              !Number.isNaN(Date.parse(group.expiresAt)) &&
              Date.parse(group.expiresAt) <= Date.now();
            const isExpanded = expandedKey === group.key;
            const isEditing = editKey === group.key && draft != null;
            const onHomeIds = new Set(
              group.recipients.filter((r) => !r.dismissed).map((r) => r.agentId),
            );
            const dismissedAgentIds = new Set(
              group.recipients.filter((r) => r.dismissed).map((r) => r.agentId),
            );
            const selectableAgents = [...agents].sort((a, b) => {
              const rank = (id: string) =>
                onHomeIds.has(id) ? 0 : dismissedAgentIds.has(id) ? 1 : 2;
              const diff = rank(a.id) - rank(b.id);
              if (diff !== 0) return diff;
              return agentLabel(a, a.id).localeCompare(agentLabel(b, b.id));
            });

            return (
              <li key={group.key} className="px-4 py-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        {group.kind}
                      </span>
                      {group.accentColor ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600"
                          title={group.accentColor}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: group.accentColor }}
                          />
                          {group.accentColor}
                        </span>
                      ) : null}
                      {expired ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          Expired
                        </span>
                      ) : null}
                      <p className="truncate text-sm font-medium text-gray-900">
                        {group.title}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Sent {new Date(group.createdAt).toLocaleString()}
                      {` · ${group.activeCount} on home · ${group.dismissedCount} dismissed`}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedKey(isExpanded ? null : group.key)
                      }
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      <Users className="h-3.5 w-3.5" />
                      {group.count} agent{group.count === 1 ? "" : "s"}:{" "}
                      {formatRecipientSummary(group)}
                      <span className="text-gray-400">
                        {isExpanded ? "· hide" : "· show all"}
                      </span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(group)}
                      className="gap-1.5"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={clearingKey === group.key}
                      onClick={() => void clearIds(group.ids, group.key)}
                      className="gap-1.5"
                    >
                      {clearingKey === group.key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Clear
                    </Button>
                  </div>
                </div>

                {isExpanded && !isEditing ? (
                  <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      Sent to
                    </p>
                    <ul className="max-h-36 space-y-1 overflow-y-auto">
                      {group.recipients.map((r) => (
                        <li
                          key={r.notificationId}
                          className="flex items-center justify-between gap-2 text-sm text-gray-800"
                        >
                          <span className="truncate">
                            {r.label}
                            {agentById.get(r.agentId)?.email &&
                            agentById.get(r.agentId)?.name
                              ? ` · ${agentById.get(r.agentId)?.email}`
                              : ""}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              r.dismissed
                                ? "bg-gray-200 text-gray-600"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {r.dismissed ? "Dismissed" : "On home"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {isEditing && draft ? (
                  <div className="space-y-4 rounded-md border border-indigo-100 bg-indigo-50/40 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-sm font-semibold text-gray-800">
                        Edit spotlight
                      </Label>
                      <button
                        type="button"
                        className="text-xs text-gray-500 hover:text-gray-700"
                        onClick={closeEdit}
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs text-gray-600">Type</Label>
                        <div className="flex gap-3">
                          {(["meeting", "urgent"] as const).map((k) => (
                            <label
                              key={k}
                              className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-800"
                            >
                              <input
                                type="radio"
                                checked={draft.kind === k}
                                onChange={() =>
                                  setDraft((d) => (d ? { ...d, kind: k } : d))
                                }
                              />
                              {k === "meeting" ? "Meeting" : "Urgent"}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs text-gray-600">Title</Label>
                        <input
                          value={draft.title}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, title: e.target.value } : d,
                            )
                          }
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs text-gray-600">Message</Label>
                        <textarea
                          value={draft.message}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, message: e.target.value } : d,
                            )
                          }
                          rows={3}
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">When</Label>
                        <input
                          type="datetime-local"
                          value={draft.startsAt}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, startsAt: e.target.value } : d,
                            )
                          }
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">Expires</Label>
                        <input
                          type="datetime-local"
                          value={draft.expiresAt}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, expiresAt: e.target.value } : d,
                            )
                          }
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">
                          Platform label
                        </Label>
                        <input
                          value={draft.platformLabel}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, platformLabel: e.target.value } : d,
                            )
                          }
                          placeholder="Microsoft Teams"
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">
                          Platform icon
                        </Label>
                        <select
                          value={draft.platformIcon ?? ""}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, platformIcon: e.target.value } : d,
                            )
                          }
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        >
                          {PLATFORM_ICON_OPTIONS.map((opt) => (
                            <option key={opt.value || "auto"} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">
                          Button label
                        </Label>
                        <input
                          value={draft.ctaLabel ?? ""}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, ctaLabel: e.target.value } : d,
                            )
                          }
                          placeholder="Join now, Open WhatsApp…"
                          maxLength={40}
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-gray-600">Link</Label>
                        <input
                          value={draft.actionUrl}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, actionUrl: e.target.value } : d,
                            )
                          }
                          placeholder="https://…"
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs text-gray-600">
                          Accent color
                        </Label>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="color"
                            value={
                              normalizeAccent(draft.accentColor) ?? "#2F80ED"
                            }
                            onChange={(e) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      accentColor: e.target.value.toUpperCase(),
                                    }
                                  : d,
                              )
                            }
                            className="h-9 w-11 cursor-pointer rounded border border-gray-300 bg-white p-1"
                          />
                          <input
                            value={draft.accentColor}
                            onChange={(e) =>
                              setDraft((d) =>
                                d ? { ...d, accentColor: e.target.value } : d,
                              )
                            }
                            placeholder="Default"
                            className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                          />
                          {ACCENT_PRESETS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() =>
                                setDraft((d) =>
                                  d ? { ...d, accentColor: c } : d,
                                )
                              }
                              className="h-6 w-6 rounded-full border border-white shadow-sm"
                              style={{ backgroundColor: c }}
                            />
                          ))}
                          {draft.accentColor ? (
                            <button
                              type="button"
                              className="text-xs text-gray-500"
                              onClick={() =>
                                setDraft((d) =>
                                  d ? { ...d, accentColor: "" } : d,
                                )
                              }
                            >
                              Default
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 border-t border-indigo-100 pt-3">
                      <Label className="text-sm font-semibold text-gray-800">
                        Apply update to agents
                      </Label>
                      <p className="text-xs text-gray-500">
                        Select anyone — on home, dismissed, or new. Edit always updates their card with this content.
                      </p>
                      {selectableAgents.length === 0 ? (
                        <p className="text-sm text-gray-600">No agents available.</p>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-800">
                              <input
                                type="checkbox"
                                checked={
                                  selectableAgents.length > 0 &&
                                  sendSelected.size === selectableAgents.length
                                }
                                onChange={() => {
                                  if (
                                    sendSelected.size === selectableAgents.length
                                  ) {
                                    setSendSelected(new Set());
                                  } else {
                                    setSendSelected(
                                      new Set(selectableAgents.map((a) => a.id)),
                                    );
                                  }
                                }}
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              Select all
                            </label>
                            <p className="text-xs text-gray-500">
                              {sendSelected.size} of {selectableAgents.length}{" "}
                              selected
                            </p>
                          </div>
                          <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200 bg-white p-2">
                            {selectableAgents.map((a) => {
                              const onHome = onHomeIds.has(a.id);
                              const wasDismissed = dismissedAgentIds.has(a.id);
                              return (
                                <label
                                  key={a.id}
                                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50"
                                >
                                  <input
                                    type="checkbox"
                                    checked={sendSelected.has(a.id)}
                                    onChange={() => toggleSendAgent(a.id)}
                                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                  />
                                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                                    {agentLabel(a, a.id)}
                                    {a.email && a.name ? ` (${a.email})` : ""}
                                  </span>
                                  {onHome ? (
                                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                                      On home
                                    </span>
                                  ) : wasDismissed ? (
                                    <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-600">
                                      Dismissed
                                    </span>
                                  ) : (
                                    <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-800">
                                      New
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            disabled={saving || sendSelected.size === 0}
                            onClick={() => void applyToSelected(group)}
                            className="gap-1.5"
                          >
                            {saving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            Apply to selected
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
