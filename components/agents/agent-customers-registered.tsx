"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { FileText, ExternalLink, Clock, CheckCircle2, Package } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RegistrationStatusActions } from "@/components/agents/registration-status-actions";

export type RegistrationRow = {
  id: string;
  customer_name: string | null;
  email: string | null;
  airtel_number: string | null;
  alternate_number: string | null;
  preferred_package: string;
  installation_town: string | null;
  delivery_landmark: string | null;
  visit_date: string | null;
  visit_time: string | null;
  status: string;
  created_at: string | null;
};

const REG_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-blue-100 text-blue-800 border-blue-200",
  installed: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

type StatusFilter = "all" | "pending" | "approved" | "installed";

interface AgentCustomersRegisteredProps {
  registrations: RegistrationRow[];
}

export function AgentCustomersRegistered({ registrations }: AgentCustomersRegisteredProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const counts = useMemo(() => {
    const all = registrations.length;
    const pending = registrations.filter((r) => r.status === "pending").length;
    const approved = registrations.filter((r) => r.status === "approved").length;
    const installed = registrations.filter((r) => r.status === "installed").length;
    return { all, pending, approved, installed };
  }, [registrations]);

  const getFiltered = (filter: StatusFilter) => {
    if (filter === "all") return registrations;
    return registrations.filter((r) => r.status === filter);
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden min-w-0 max-w-full">
      <div className="border-b border-gray-100 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Customers registered
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {counts.all} customer{counts.all === 1 ? "" : "s"}
          </span>
          <Link
            href="/dashboard/registrations"
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            View all registrations
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {registrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-gray-500">
          <FileText className="h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm">No customers registered yet.</p>
          <Link
            href="/dashboard/registrations"
            className="mt-3 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            View all registrations →
          </Link>
        </div>
      ) : (
        <>
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)} className="w-full">
            <div className="border-b border-gray-100 px-4 pt-2">
              <TabsList className="h-8 w-full justify-start rounded-lg bg-gray-50 p-0.5">
                <TabsTrigger value="all" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  All ({counts.all})
                </TabsTrigger>
                <TabsTrigger value="pending" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Clock className="mr-1.5 h-3.5 w-3.5" />
                  Pending ({counts.pending})
                </TabsTrigger>
                <TabsTrigger value="approved" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Approved ({counts.approved})
                </TabsTrigger>
                <TabsTrigger value="installed" className="rounded-md px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-sm">
                  <Package className="mr-1.5 h-3.5 w-3.5" />
                  Installed ({counts.installed})
                </TabsTrigger>
              </TabsList>
            </div>

            {(["all", "pending", "approved", "installed"] as const).map((tabValue) => {
              const filtered = getFiltered(tabValue);
              return (
                <TabsContent key={tabValue} value={tabValue} className="mt-0 outline-none">
                  {filtered.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-500">
                      {tabValue === "all" ? "No registrations." : `No ${tabValue} registrations.`}
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <table className="w-full table-fixed text-xs">
                        <colgroup>
                          <col className="w-[16%]" />
                          <col className="w-[20%]" />
                          <col className="w-[7%]" />
                          <col className="w-[14%]" />
                          <col className="w-[10%]" />
                          <col className="w-[9%]" />
                          <col className="w-[10%]" />
                          <col className="w-[14%]" />
                        </colgroup>
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                            <th className="px-2 py-2">Customer</th>
                            <th className="px-2 py-2">Contact</th>
                            <th className="px-2 py-2">Pkg</th>
                            <th className="px-2 py-2">Location</th>
                            <th className="px-2 py-2">Status</th>
                            <th className="px-2 py-2">Date</th>
                            <th className="px-2 py-2">Visit</th>
                            <th className="px-2 py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((reg) => {
                            const regStatusStyle = REG_STATUS_STYLES[reg.status] ?? "bg-gray-100 text-gray-800 border-gray-200";
                            const contact = [reg.airtel_number, reg.alternate_number, reg.email].filter(Boolean).join(" · ") || "—";
                            const visit = [reg.visit_date, reg.visit_time].filter(Boolean).join(" ") || "—";
                            const dateStr = reg.created_at
                              ? new Date(reg.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })
                              : "—";
                            return (
                              <tr key={reg.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50">
                                <td className="px-2 py-2 font-medium text-gray-900 truncate" title={reg.customer_name || undefined}>
                                  {reg.customer_name || "—"}
                                </td>
                                <td className="px-2 py-2 text-gray-600 truncate" title={contact}>
                                  {contact}
                                </td>
                                <td className="px-2 py-2">
                                  <span
                                    className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${
                                      reg.preferred_package === "premium" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"
                                    }`}
                                  >
                                    {reg.preferred_package === "premium" ? "P" : "S"}
                                  </span>
                                </td>
                                <td className="px-2 py-2 text-gray-600 truncate" title={reg.installation_town || reg.delivery_landmark || undefined}>
                                  {reg.installation_town || reg.delivery_landmark || "—"}
                                </td>
                                <td className="px-2 py-2">
                                  <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${regStatusStyle}`}>
                                    {reg.status}
                                  </span>
                                </td>
                                <td className="px-2 py-2 text-gray-500 tabular-nums whitespace-nowrap" title={reg.created_at ? new Date(reg.created_at).toLocaleDateString() : undefined}>
                                  {dateStr}
                                </td>
                                <td className="px-2 py-2 text-gray-500 truncate" title={visit || undefined}>
                                  {visit === "—" ? "—" : visit}
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <RegistrationStatusActions registration={{ id: reg.id, status: reg.status }} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </>
      )}
    </section>
  );
}
