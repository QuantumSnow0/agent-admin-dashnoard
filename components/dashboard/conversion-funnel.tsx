import type { ConversionFunnel } from "@/lib/dashboard-chart-data";

function FunnelColumn({
  label,
  funnel,
}: {
  label: string;
  funnel: ConversionFunnel;
}) {
  const steps = [
    { name: "Registered", value: funnel.registered, pct: null },
    {
      name: "Approved+",
      value: funnel.approved,
      pct: funnel.registeredToApprovedPct,
    },
    {
      name: "Installed",
      value: funnel.installed,
      pct: funnel.approvedToInstalledPct,
    },
  ];

  const max = Math.max(funnel.registered, 1);

  return (
    <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-600">
        {label}
      </h3>
      <div className="space-y-3">
        {steps.map((step, index) => (
          <div key={step.name}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700">{step.name}</span>
              <span className="tabular-nums text-gray-900">
                {step.value.toLocaleString()}
                {step.pct != null ? (
                  <span className="ml-1 text-gray-500">({step.pct}%)</span>
                ) : null}
              </span>
            </div>
            <div className="h-2 bg-gray-100">
              <div
                className="h-2 bg-indigo-600 transition-all"
                style={{ width: `${Math.max(4, (step.value / max) * 100)}%` }}
              />
            </div>
            {index === steps.length - 1 ? (
              <p className="mt-2 text-xs text-gray-500">
                Overall conversion: {funnel.registeredToInstalledPct}%
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConversionFunnelSection({
  overall,
  airtel,
  safaricom,
}: {
  overall: ConversionFunnel;
  airtel: ConversionFunnel;
  safaricom: ConversionFunnel;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <FunnelColumn label="Conversion funnel (all)" funnel={overall} />
      <FunnelColumn label="Airtel funnel" funnel={airtel} />
      <FunnelColumn label="Safaricom funnel" funnel={safaricom} />
    </div>
  );
}
