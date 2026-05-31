"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ChartRangeData, TopSellingAgent } from "@/lib/dashboard-chart-data";

const REGISTRATIONS_COLOR = "#2563eb";
const REVENUE_COLOR = "#0d9488";
const AIRTEL_COLOR = "#E60012";
const SAFARICOM_COLOR = "#00A651";
const PIE_COLORS = ["#4f46e5", "#7c3aed", "#059669"];
const PIE_LABEL_COLORS = ["#818cf8", "#a78bfa", "#34d399"];

export type {
  RegistrationsByDay,
  RevenueByDay,
  PackageMix,
  TopSellingAgent,
  ChartRangeData,
} from "@/lib/dashboard-chart-data";

type ChartRangeKey = 7 | 30;

interface DashboardChartsProps {
  chartDataByRange: Record<ChartRangeKey, ChartRangeData>;
}

function TopAgentsBarChart({
  title,
  data,
  emptyMessage,
  stackId,
}: {
  title: string;
  data: TopSellingAgent[];
  emptyMessage: string;
  stackId: string;
}) {
  return (
    <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-600">
        {title}
      </h3>
      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-gray-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="agent"
                width={120}
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 0 }}
                formatter={(value: number | undefined, name: string | undefined) => [
                  value ?? 0,
                  name ?? "",
                ]}
                labelFormatter={(label) => `${label}`}
              />
              <Legend />
              <Bar dataKey="airtel" stackId={stackId} fill={AIRTEL_COLOR} name="Airtel" radius={0} />
              <Bar
                dataKey="safaricom"
                stackId={stackId}
                fill={SAFARICOM_COLOR}
                name="Safaricom"
                radius={0}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function RangeToggle({
  value,
  onChange,
}: {
  value: ChartRangeKey;
  onChange: (value: ChartRangeKey) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
        Period
      </span>
      {([7, 30] as const).map((days) => (
        <button
          key={days}
          type="button"
          onClick={() => onChange(days)}
          className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
            value === days
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {days} days
        </button>
      ))}
    </div>
  );
}

export function DashboardCharts({ chartDataByRange }: DashboardChartsProps) {
  const [range, setRange] = useState<ChartRangeKey>(30);
  const {
    registrationsByDay,
    revenueByDay,
    packageMix,
    topSellingAgents,
    topInstalledAgents,
  } = chartDataByRange[range];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
          Analytics
        </h2>
        <RangeToggle value={range} onChange={setRange} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-600">
            Registrations (last {range} days)
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={registrationsByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillRegistrations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={REGISTRATIONS_COLOR} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={REGISTRATIONS_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 0 }}
                  formatter={(value: number | undefined) => [value ?? 0, "Registrations"]}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={REGISTRATIONS_COLOR}
                  strokeWidth={2}
                  fill="url(#fillRegistrations)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-600">
            Commission earned (last {range} days)
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => `KSh ${v}`} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 0 }}
                  formatter={(value: number | undefined) => [
                    `KSh ${(value ?? 0).toLocaleString()}`,
                    "Commission",
                  ]}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Bar dataKey="revenue" fill={REVENUE_COLOR} radius={0} name="Commission" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <TopAgentsBarChart
          title={`Top 10 selling agents — registrations (last ${range} days)`}
          data={topSellingAgents}
          emptyMessage="No registrations in this period."
          stackId={`registrations-${range}`}
        />

        <TopAgentsBarChart
          title={`Top 10 selling agents — installed (last ${range} days)`}
          data={topInstalledAgents}
          emptyMessage="No installations in this period."
          stackId={`installed-${range}`}
        />

        <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-600">
            Installed mix (last {range} days)
          </h3>
          <div className="mx-auto h-64 max-w-sm">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={packageMix}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  label={({ name, percent, x, y, index }) => (
                    <text
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={
                        PIE_LABEL_COLORS[
                          typeof index === "number" ? index % PIE_LABEL_COLORS.length : 0
                        ]
                      }
                      fillOpacity={1}
                      style={{ fontSize: 13, fontWeight: 600 }}
                    >
                      {name} {((percent ?? 0) * 100).toFixed(0)}%
                    </text>
                  )}
                  labelLine={false}
                >
                  {packageMix.map((_, index) => (
                    <Cell
                      key={index}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                      fillOpacity={1}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 0 }}
                  formatter={(value: number | undefined, name: string | undefined) => [
                    `${value ?? 0} installs`,
                    name ?? "",
                  ]}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
