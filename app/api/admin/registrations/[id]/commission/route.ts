import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

type Body = {
  commissionPackage?: "standard" | "premium" | null;
  commissionUnits?: number | null;
  clearOverride?: boolean;
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

  const update: {
    commission_package?: string | null;
    commission_units?: number | null;
  } = {};

  if (body.clearOverride) {
    update.commission_package = null;
    update.commission_units = null;
  } else {
    if (body.commissionPackage !== undefined) {
      if (
        body.commissionPackage !== null &&
        body.commissionPackage !== "standard" &&
        body.commissionPackage !== "premium"
      ) {
        return NextResponse.json({ error: "Invalid package" }, { status: 400 });
      }
      update.commission_package = body.commissionPackage;
    }
    if (body.commissionUnits !== undefined) {
      if (body.commissionUnits !== null) {
        const u = Math.floor(Number(body.commissionUnits));
        if (!Number.isFinite(u) || u < 1 || u > 2) {
          return NextResponse.json(
            { error: "Units must be 1 or 2" },
            { status: 400 }
          );
        }
        update.commission_units = u;
      } else {
        update.commission_units = null;
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service
      .from("customer_registrations")
      .update(update)
      .eq("id", id)
      .select(
        "id, agent_id, preferred_package, units_required, commission_package, commission_units, status"
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    }

    return NextResponse.json({ registration: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
