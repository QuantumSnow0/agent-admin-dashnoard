import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdminApi } from "@/lib/admin-api";
import { DISPATCH_DEFAULTS } from "@/lib/dispatch/constants";
import { clampServiceRadiusKm } from "@/lib/dispatch/matching";

type Body = {
  default_service_radius_km?: number;
  lead_submitter_commission_kes?: number;
  lead_receiver_commission_kes?: number;
  lead_submitter_commission_standard_kes?: number;
  lead_submitter_commission_premium_kes?: number;
  lead_receiver_commission_standard_kes?: number;
  lead_receiver_commission_premium_kes?: number;
};

const PACKAGE_FEE_KEYS = [
  "lead_submitter_commission_standard_kes",
  "lead_submitter_commission_premium_kes",
  "lead_receiver_commission_standard_kes",
  "lead_receiver_commission_premium_kes",
] as const;

function clampCommissionKes(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  if (n < 0 || n > 100000) return null;
  return n;
}

const SELECT_FIELDS =
  "id, default_service_radius_km, lead_submitter_commission_kes, lead_receiver_commission_kes, lead_submitter_commission_standard_kes, lead_submitter_commission_premium_kes, lead_receiver_commission_standard_kes, lead_receiver_commission_premium_kes" as const;

type DispatchConfigFeeRow = {
  id: string;
  default_service_radius_km: number | null;
  lead_submitter_commission_kes: number | null;
  lead_receiver_commission_kes: number | null;
  lead_submitter_commission_standard_kes: number | null;
  lead_submitter_commission_premium_kes: number | null;
  lead_receiver_commission_standard_kes: number | null;
  lead_receiver_commission_premium_kes: number | null;
};

export async function PATCH(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, number> = {};

  if (body.default_service_radius_km != null) {
    const raw = Number(body.default_service_radius_km);
    if (!Number.isFinite(raw) || raw <= 0) {
      return NextResponse.json(
        { error: "Enter a radius between 0.5 and 50 km" },
        { status: 400 },
      );
    }
    updates.default_service_radius_km = clampServiceRadiusKm(raw);
  }

  for (const key of PACKAGE_FEE_KEYS) {
    if (body[key] != null) {
      const kes = clampCommissionKes(Number(body[key]));
      if (kes == null) {
        return NextResponse.json(
          { error: `${key} must be 0–100000 KSh` },
          { status: 400 },
        );
      }
      updates[key] = kes;
    }
  }

  // Legacy flat fields (older clients): still accepted; mirrored to both packages.
  if (body.lead_submitter_commission_kes != null) {
    const kes = clampCommissionKes(Number(body.lead_submitter_commission_kes));
    if (kes == null) {
      return NextResponse.json(
        { error: "Submitter commission must be 0–100000 KSh" },
        { status: 400 },
      );
    }
    updates.lead_submitter_commission_kes = kes;
    if (body.lead_submitter_commission_standard_kes == null) {
      updates.lead_submitter_commission_standard_kes = kes;
    }
    if (body.lead_submitter_commission_premium_kes == null) {
      updates.lead_submitter_commission_premium_kes = kes;
    }
  }

  if (body.lead_receiver_commission_kes != null) {
    const kes = clampCommissionKes(Number(body.lead_receiver_commission_kes));
    if (kes == null) {
      return NextResponse.json(
        { error: "Receiver commission must be 0–100000 KSh" },
        { status: 400 },
      );
    }
    updates.lead_receiver_commission_kes = kes;
    if (body.lead_receiver_commission_standard_kes == null) {
      updates.lead_receiver_commission_standard_kes = kes;
    }
    if (body.lead_receiver_commission_premium_kes == null) {
      updates.lead_receiver_commission_premium_kes = kes;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const { data: existingRaw } = await service
      .from("dispatch_config")
      .select(SELECT_FIELDS)
      .limit(1)
      .maybeSingle();

    const existing = existingRaw as DispatchConfigFeeRow | null;

    if (!existing?.id) {
      return NextResponse.json(
        { error: "Dispatch config row is missing" },
        { status: 500 },
      );
    }

    const nextSubmitterStd =
      updates.lead_submitter_commission_standard_kes ??
      Number(existing.lead_submitter_commission_standard_kes) ??
      0;
    const nextSubmitterPrem =
      updates.lead_submitter_commission_premium_kes ??
      Number(existing.lead_submitter_commission_premium_kes) ??
      0;
    const nextReceiverStd =
      updates.lead_receiver_commission_standard_kes ??
      Number(existing.lead_receiver_commission_standard_kes) ??
      0;
    const nextReceiverPrem =
      updates.lead_receiver_commission_premium_kes ??
      Number(existing.lead_receiver_commission_premium_kes) ??
      0;

    if (
      updates.lead_submitter_commission_standard_kes != null ||
      updates.lead_submitter_commission_premium_kes != null
    ) {
      updates.lead_submitter_commission_kes = Math.max(
        nextSubmitterStd,
        nextSubmitterPrem,
      );
    }
    if (
      updates.lead_receiver_commission_standard_kes != null ||
      updates.lead_receiver_commission_premium_kes != null
    ) {
      updates.lead_receiver_commission_kes = Math.max(
        nextReceiverStd,
        nextReceiverPrem,
      );
    }

    const { data: updatedRaw, error } = await service
      .from("dispatch_config")
      .update(updates)
      .eq("id", existing.id)
      .select(SELECT_FIELDS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const data = updatedRaw as DispatchConfigFeeRow;

    return NextResponse.json({
      success: true,
      default_service_radius_km:
        Number(data.default_service_radius_km) ||
        DISPATCH_DEFAULTS.defaultServiceRadiusKm,
      lead_submitter_commission_kes: Number(data.lead_submitter_commission_kes) || 0,
      lead_receiver_commission_kes: Number(data.lead_receiver_commission_kes) || 0,
      lead_submitter_commission_standard_kes:
        Number(data.lead_submitter_commission_standard_kes) || 0,
      lead_submitter_commission_premium_kes:
        Number(data.lead_submitter_commission_premium_kes) || 0,
      lead_receiver_commission_standard_kes:
        Number(data.lead_receiver_commission_standard_kes) || 0,
      lead_receiver_commission_premium_kes:
        Number(data.lead_receiver_commission_premium_kes) || 0,
    });
  } catch (err) {
    console.error("[admin/dispatch-config]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
