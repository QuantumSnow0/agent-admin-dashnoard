import { requireDashboardAdmin } from "@/lib/utils/admin";
import { ImageIcon } from "lucide-react";
import { HomePromosManager } from "@/components/home-promos/home-promos-manager";
import type { HomePromo } from "@/lib/home-promos";

export default async function HomePromosPage() {
  const { supabase } = await requireDashboardAdmin();

  const { data: promos } = await supabase
    .from("home_promos")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6 -ml-2 -mt-6">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-6 w-6 text-gray-700" />
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          Home promos
        </h1>
      </div>

      <p className="text-sm text-gray-600 max-w-2xl">
        Manage the carousel on the agent app Home screen. Upload images, set
        copy and CTA, and activate or pause slides without shipping an app
        update.
      </p>

      <HomePromosManager initialPromos={(promos ?? []) as HomePromo[]} />
    </div>
  );
}
