"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { Bell, Loader2 } from "lucide-react";

type TargetKind = "one" | "multiple" | "all";

type AgentOption = {
  id: string;
  name: string | null;
  email: string | null;
};

interface SendNotificationFormProps {
  agents: AgentOption[];
  /** Pre-select this agent (e.g. from agent profile link). */
  initialAgentId?: string | null;
}

const NOTIFICATION_TYPE = "SYSTEM_ANNOUNCEMENT";

export function SendNotificationForm({ agents, initialAgentId }: SendNotificationFormProps) {
  const [targetKind, setTargetKind] = useState<TargetKind>("one");
  const [selectedOne, setSelectedOne] = useState<string>(initialAgentId ?? "");
  useEffect(() => {
    if (initialAgentId && agents.some((a) => a.id === initialAgentId)) {
      setTargetKind("one");
      setSelectedOne(initialAgentId);
    }
  }, [initialAgentId, agents]);
  const [selectedMultiple, setSelectedMultiple] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
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

    try {
      const supabase = createClient();
      const rows = ids.map((agent_id) => ({
        agent_id,
        type: NOTIFICATION_TYPE,
        title: title.trim(),
        message: message.trim(),
        metadata: { source: "admin_dashboard", custom: true },
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
      setSelectedOne("");
      setSelectedMultiple(new Set());
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
        <Label htmlFor="title" className="text-sm font-semibold text-gray-700">Title</Label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. System maintenance"
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

      <Button type="submit" disabled={sending} className="gap-2">
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
