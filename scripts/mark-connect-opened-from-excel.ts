/**
 * One-off: mark Airtel Connect opened + notify from Excel export.
 * Usage: npx tsx scripts/mark-connect-opened-from-excel.ts [--apply]
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const INPUT = resolve(__dirname, "../tmp-connect-accounts.json");
const REPORT = resolve(__dirname, "../tmp-connect-opened-report.json");

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.airtel.airtelwork.africa";

type SheetRow = {
  name: string;
  airtel_phone: number | string | null;
  safaricom_phone: number | string | null;
  status: string;
};

type AgentRow = {
  id: string;
  name: string | null;
  airtel_phone: string | null;
  safaricom_phone: string | null;
  airtel_connect_opened: boolean | null;
  status: string | null;
};

function digitsOnly(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Canonical last-9 mobile digits for Kenya matching (Excel drops leading 0). */
function phoneKeys(value: unknown): string[] {
  const d = digitsOnly(value);
  if (!d) return [];
  const keys = new Set<string>();
  if (d.length >= 9) keys.add(d.slice(-9));
  if (d.startsWith("254") && d.length >= 12) keys.add(d.slice(-9));
  if (d.startsWith("0") && d.length >= 10) keys.add(d.slice(-9));
  return [...keys];
}

function buildNotifyMessage(agentName?: string | null): {
  title: string;
  message: string;
} {
  const firstName = agentName?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const title = "Your Airtel Connect account is ready";
  const message = [
    `${greeting} we've opened your Airtel Connect account.`,
    "",
    "GET STARTED",
    "1. Install Airtel Connect (Play Store → “Airtel Connect” / Airtel Work).",
    "2. Open the app and allow permissions.",
    "3. Sign in with your registered Airtel / agent line.",
    "4. Finish first-time setup, then keep the app updated.",
    "",
    "ORDER ID (REQUIRED)",
    "After KYC / install work in Airtel Connect, copy the Order ID.",
    "Add that Order ID in WAM Apps on the registration — it is required for installation and payment.",
    "You can paste it when finishing Connect → WAM, or later under Registrations.",
    "",
    "NEED HELP?",
    "Login or credentials issues → WAM Apps → Help.",
    "",
    `Play Store: ${PLAY_STORE_URL}`,
  ].join("\n");
  return { title, message };
}

async function deliverPush(
  supabaseUrl: string,
  serviceKey: string,
  notification: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ record: notification }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: text.slice(0, 300) };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const sheet = JSON.parse(readFileSync(INPUT, "utf8")) as SheetRow[];
  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: agents, error } = await service
    .from("agents")
    .select(
      "id, name, airtel_phone, safaricom_phone, airtel_connect_opened, status",
    );
  if (error) throw error;

  const byPhone = new Map<string, AgentRow[]>();
  for (const agent of (agents ?? []) as AgentRow[]) {
    for (const keyPhone of [
      ...phoneKeys(agent.airtel_phone),
      ...phoneKeys(agent.safaricom_phone),
    ]) {
      const list = byPhone.get(keyPhone) ?? [];
      if (!list.some((a) => a.id === agent.id)) list.push(agent);
      byPhone.set(keyPhone, list);
    }
  }

  const matched: Array<{
    sheet: SheetRow;
    agent: AgentRow;
    matchVia: string;
  }> = [];
  const ambiguous: Array<{ sheet: SheetRow; agents: AgentRow[] }> = [];
  const unmatched: SheetRow[] = [];
  const alreadyOpen: Array<{ sheet: SheetRow; agent: AgentRow }> = [];

  for (const row of sheet) {
    const keys = [
      ...phoneKeys(row.airtel_phone),
      ...phoneKeys(row.safaricom_phone),
    ];
    const found = new Map<string, AgentRow>();
    let matchVia = "";
    for (const k of keys) {
      for (const agent of byPhone.get(k) ?? []) {
        found.set(agent.id, agent);
        if (!matchVia) matchVia = k;
      }
    }
    const list = [...found.values()];
    if (list.length === 0) {
      unmatched.push(row);
      continue;
    }
    if (list.length > 1) {
      const sheetName = row.name.trim().toLowerCase();
      const nameHits = list.filter((a) => {
        const n = (a.name ?? "").trim().toLowerCase();
        return (
          n === sheetName ||
          n.includes(sheetName) ||
          sheetName.includes(n) ||
          n.split(/\s+/).slice(0, 2).join(" ") ===
            sheetName.split(/\s+/).slice(0, 2).join(" ")
        );
      });
      if (nameHits.length === 1) {
        const agent = nameHits[0];
        if (agent.airtel_connect_opened === true) {
          alreadyOpen.push({ sheet: row, agent });
        } else {
          matched.push({ sheet: row, agent, matchVia: `${matchVia}+name` });
        }
        continue;
      }
      ambiguous.push({ sheet: row, agents: list });
      continue;
    }
    const agent = list[0];
    if (agent.airtel_connect_opened === true) {
      alreadyOpen.push({ sheet: row, agent });
      continue;
    }
    matched.push({ sheet: row, agent, matchVia });
  }

  const summary = {
    mode: APPLY ? "apply" : "dry-run",
    sheetRows: sheet.length,
    matchedToOpen: matched.length,
    alreadyOpen: alreadyOpen.length,
    ambiguous: ambiguous.length,
    unmatched: unmatched.length,
  };
  console.log(JSON.stringify(summary, null, 2));

  const results: Array<Record<string, unknown>> = [];

  if (APPLY) {
    const now = new Date().toISOString();
    for (const item of matched) {
      const { agent, sheet: row } = item;
      const { error: updErr } = await service
        .from("agents")
        .update({
          airtel_connect_opened: true,
          airtel_connect_opened_at: now,
        })
        .eq("id", agent.id);
      if (updErr) {
        results.push({
          name: row.name,
          agentId: agent.id,
          ok: false,
          stage: "update",
          error: updErr.message,
        });
        continue;
      }

      const { title, message } = buildNotifyMessage(agent.name ?? row.name);
      const { data: notification, error: notifErr } = await service
        .from("notifications")
        .insert({
          agent_id: agent.id,
          type: "SYSTEM_ANNOUNCEMENT",
          title,
          message,
          is_read: false,
          metadata: {
            source: "admin_dashboard",
            kind: "airtel_connect_opened",
            deepLink: "notifications",
            playStoreUrl: PLAY_STORE_URL,
            packageId: "com.airtel.airtelwork.africa",
            ctaLabel: "View instructions",
            orderIdRequired: true,
            bulkFromExcel: true,
          },
        })
        .select("id, agent_id, type, title, message, related_id, metadata")
        .single();

      if (notifErr || !notification) {
        results.push({
          name: row.name,
          agentId: agent.id,
          ok: false,
          stage: "notify_insert",
          error: notifErr?.message ?? "insert_failed",
        });
        continue;
      }

      const push = await deliverPush(url, key, notification as Record<string, unknown>);
      results.push({
        name: row.name,
        agentId: agent.id,
        agentName: agent.name,
        ok: true,
        notified: true,
        pushOk: push.ok,
        pushError: push.error ?? null,
      });
      // gentle pacing for push
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const report = {
    summary,
    matched: matched.map((m) => ({
      sheetName: m.sheet.name,
      sheetAirtel: m.sheet.airtel_phone,
      agentId: m.agent.id,
      agentName: m.agent.name,
      agentStatus: m.agent.status,
      matchVia: m.matchVia,
    })),
    alreadyOpen: alreadyOpen.map((m) => ({
      sheetName: m.sheet.name,
      agentId: m.agent.id,
      agentName: m.agent.name,
    })),
    ambiguous: ambiguous.map((a) => ({
      sheetName: a.sheet.name,
      sheetAirtel: a.sheet.airtel_phone,
      candidates: a.agents.map((x) => ({
        id: x.id,
        name: x.name,
        airtel_phone: x.airtel_phone,
        safaricom_phone: x.safaricom_phone,
      })),
    })),
    unmatched: unmatched.map((u) => ({
      name: u.name,
      airtel_phone: u.airtel_phone,
      safaricom_phone: u.safaricom_phone,
    })),
    applyResults: results,
  };

  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`Report: ${REPORT}`);
  if (!APPLY) {
    console.log("Dry-run only. Re-run with --apply to mark opened + notify.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
