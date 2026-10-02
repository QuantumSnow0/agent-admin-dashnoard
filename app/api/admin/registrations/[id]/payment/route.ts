import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type Body = {
  decision?: "approved" | "denied";
  amountKes?: number;
  mpesaReference?: string;
  reason?: string;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: admin } = await supabase
    .from("agents")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!admin?.is_admin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await context.params;
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.decision !== "approved" && body.decision !== "denied") {
    return NextResponse.json({ error: "Choose approve or deny" }, { status: 400 });
  }

  const update: {
    status: "approved" | "denied";
    approved_amount_kes: number | null;
    denial_reason: string | null;
    mpesa_reference: string | null;
  } = {
    status: body.decision,
    approved_amount_kes: null,
    denial_reason: null,
    mpesa_reference: null,
  };

  if (body.decision === "approved") {
    const amount = Math.round(Number(body.amountKes));
    if (!Number.isFinite(amount) || amount < 1) {
      return NextResponse.json(
        { error: "Enter the payment amount" },
        { status: 400 }
      );
    }
    const mpesaReference = String(body.mpesaReference ?? "")
      .replace(/\s+/g, "")
      .toUpperCase();
    if (!/^[A-Z0-9]{6,20}$/.test(mpesaReference)) {
      return NextResponse.json(
        { error: "Enter the M-Pesa reference code" },
        { status: 400 }
      );
    }
    update.approved_amount_kes = amount;
    update.mpesa_reference = mpesaReference;
  } else {
    const reason = String(body.reason ?? "").trim();
    if (reason.length < 3) {
      return NextResponse.json(
        { error: "Enter a reason for denial" },
        { status: 400 }
      );
    }
    update.denial_reason = reason;
  }

  try {
    const service = createServiceClient();
    const { data: existing, error: existingError } = await service
      .from("customer_registrations")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    }
    if (existing.status !== "installed") {
      return NextResponse.json(
        { error: "Only an installed registration can be approved or denied" },
        { status: 400 }
      );
    }

    const { data, error } = await service
      .from("customer_registrations")
      .update(update)
      .eq("id", id)
      .select("id, status, approved_amount_kes, denial_reason, mpesa_reference")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ registration: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
