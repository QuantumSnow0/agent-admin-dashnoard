"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { AppRatingSummary } from "@/lib/app-rating-chart-data";

const BAR_COLORS: Record<string, string> = {
  "5": "#16a34a",
  "4": "#84cc16",
  "3": "#eab308",
  "2": "#f97316",
  "1": "#ef4444",
};

interface AppRatingsChartProps {
  summary: AppRatingSummary;
}

export function AppRatingsChart({ summary }: AppRatingsChartProps) {
  const { totalRatings, averageScore, distribution, playStoreOpens } = summary;

  return (
    <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-600">
            App ratings
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            In-app star ratings from agents
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-gray-500">Average </span>
            <span className="font-semibold text-gray-900">
              {averageScore != null ? averageScore.toFixed(1) : "—"}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Total </span>
            <span className="font-semibold text-gray-900">{totalRatings}</span>
          </div>
          <div>
            <span className="text-gray-500">Play Store taps </span>
            <span className="font-semibold text-gray-900">{playStoreOpens}</span>
          </div>
        </div>
      </div>

      {totalRatings === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-gray-500">
          No ratings yet. Ratings appear here after agents submit feedback in the app.
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={distribution}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
              <XAxis
                dataKey="score"
                tick={{ fontSize: 12 }}
                stroke="#9ca3af"
                tickFormatter={(value) => `${value}★`}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 0 }}
                formatter={(value: number | undefined, _name, item) => [
                  value ?? 0,
                  item?.payload?.label ?? "Ratings",
                ]}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {distribution.map((row) => (
                  <Cell key={row.score} fill={BAR_COLORS[row.score] ?? "#6366f1"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
