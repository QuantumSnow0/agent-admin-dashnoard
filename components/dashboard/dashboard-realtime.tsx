"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to Supabase Realtime for agents and customer_registrations.
 * When data changes, refreshes the dashboard so cards and charts update.
 *
 * Ensure Realtime is enabled in Supabase:
 * Dashboard → Database → Replication → add "agents", "customer_registrations",
 * and "safaricom_registrations" to the supabase_realtime publication.
 */
export function DashboardRealtime() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    console.log("📡 [Dashboard Realtime] Setting up subscriptions...");

    const channel = supabase
      .channel("dashboard-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agents" },
        (payload) => {
          console.log("🔄 [Dashboard Realtime] agents changed:", payload);
          router.refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer_registrations" },
        (payload) => {
          console.log("🔄 [Dashboard Realtime] customer_registrations changed:", payload);
          router.refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "safaricom_registrations" },
        (payload) => {
          console.log("🔄 [Dashboard Realtime] safaricom_registrations changed:", payload);
          router.refresh();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("✅ [Dashboard Realtime] Subscribed successfully");
        } else if (status === "CHANNEL_ERROR") {
          console.error("❌ [Dashboard Realtime] Subscription error");
        } else {
          console.log(`📡 [Dashboard Realtime] Status: ${status}`);
        }
      });

    return () => {
      console.log("🔌 [Dashboard Realtime] Unsubscribing...");
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
