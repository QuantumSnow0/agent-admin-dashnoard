"use client";

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

const REGISTRATIONS_COLOR = "#2563eb";
const REVENUE_COLOR = "#0d9488";
const PIE_COLORS = ["#4f46e5", "#7c3aed"]; // indigo-600, violet-600 (slice fill)
const PIE_LABEL_COLORS = ["#818cf8", "#a78bfa"]; // lighter tint of each slice – Standard, Premium

export type RegistrationsByDay = { date: string; count: number }[];
export type RevenueByDay = { date: string; revenue: number }[];
export type PackageMix = { name: string; value: number }[];

interface DashboardChartsProps {
  registrationsByDay: RegistrationsByDay;
  revenueByDay: RevenueByDay;
  packageMix: PackageMix;
}

export function DashboardCharts({
  registrationsByDay,
  revenueByDay,
  packageMix,
}: DashboardChartsProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Registrations over time */}
      <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-600">
          Registrations (last 30 days)
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

      {/* Revenue over time */}
      <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-600">
          Revenue (last 30 days)
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={revenueByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" tickFormatter={(v) => `KSh ${v}`} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 0 }}
                formatter={(value: number | undefined) => [`KSh ${(value ?? 0).toLocaleString()}`, "Revenue"]}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Bar dataKey="revenue" fill={REVENUE_COLOR} radius={0} name="Revenue" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Package mix (full width or in grid) */}
      <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-600">
          Package mix (installed)
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
                    fill={PIE_LABEL_COLORS[typeof index === "number" ? index % PIE_LABEL_COLORS.length : 0]}
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
                formatter={(value: number | undefined, name: string | undefined) => [`${value ?? 0} installations`, name ?? ""]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
