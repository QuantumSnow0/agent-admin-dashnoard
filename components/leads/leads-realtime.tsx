"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

type LeadsRealtimeProps = {
  onRefresh: () => void;
  onStatus?: (connected: boolean) => void;
};

const POLL_MS = 20_000;
const SWEEP_MS = 60_000;

/**
 * Refreshes leads via onRefresh when inbound_leads / lead_offers change.
 * Falls back to polling every 20s if Realtime is slow or unavailable.
 */
export function LeadsRealtime({ onRefresh, onStatus }: LeadsRealtimeProps) {
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRefreshRef = useRef(onRefresh);
  const onStatusRef = useRef(onStatus);
  onRefreshRef.current = onRefresh;
  onStatusRef.current = onStatus;

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let sweepId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        onRefreshRef.current();
      }, 300);
    };

    const runSweep = async () => {
      try {
        await fetch("/api/admin/dispatch/sweep", { method: "POST" });
      } catch {
        // Non-fatal — refresh still updates the table
      }
    };

    const setup = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (!session) {
        onStatusRef.current?.(false);
        return;
      }

      channel = supabase
        .channel(`admin-inbound-leads-${session.user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "inbound_leads" },
          () => scheduleRefresh(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "lead_offers" },
          () => scheduleRefresh(),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            onStatusRef.current?.(true);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            onStatusRef.current?.(false);
          }
        });

      pollId = setInterval(() => {
        onRefreshRef.current();
      }, POLL_MS);

      sweepId = setInterval(() => {
        void runSweep();
      }, SWEEP_MS);

      void runSweep();
    };

    void setup();

    return () => {
      cancelled = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (pollId) clearInterval(pollId);
      if (sweepId) clearInterval(sweepId);
      if (channel) supabase.removeChannel(channel);
      onStatusRef.current?.(false);
    };
  }, []);

  return null;
}
