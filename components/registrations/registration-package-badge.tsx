import type { AdminRegistrationRow } from "@/lib/admin-registrations";

export function RegistrationPackageBadge({ reg }: { reg: AdminRegistrationRow }) {
  if (reg.source === "airtel") {
    const premium = reg.preferred_package === "premium";
    return (
      <span
        className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${
          premium ? "bg-violet-100 text-violet-800 border-violet-200" : "bg-slate-100 text-slate-700 border-slate-200"
        }`}
        title={premium ? "Premium" : "Standard"}
      >
        {premium ? "P" : "S"}
      </span>
    );
  }
  const sp = reg.safaricom_service_package;
  if (sp === "home_business_fiber") {
    return (
      <span
        className="inline-flex rounded border border-emerald-200 bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-900"
        title={reg.preferred_package}
      >
        Fib
      </span>
    );
  }
  if (sp === "safaricom_portable_5g") {
    return (
      <span
        className="inline-flex rounded border border-sky-200 bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-900"
        title={reg.preferred_package}
      >
        5G
      </span>
    );
  }
  if (sp === "safaricom_dedicated_wifi") {
    return (
      <span
        className="inline-flex rounded border border-indigo-200 bg-indigo-100 px-1.5 py-0.5 text-[11px] font-medium text-indigo-900"
        title={reg.preferred_package}
      >
        Wi‑Fi
      </span>
    );
  }
  return (
    <span className="inline-flex rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">
      {reg.preferred_package.slice(0, 4)}
    </span>
  );
}
