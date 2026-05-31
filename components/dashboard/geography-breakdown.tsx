"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { GeographyBreakdownRow } from "@/lib/dashboard-chart-data";

const AIRTEL_COLOR = "#E60012";
const SAFARICOM_COLOR = "#00A651";

function LocationBarChart({
  title,
  data,
  emptyMessage,
  stackId,
}: {
  title: string;
  data: GeographyBreakdownRow[];
  emptyMessage: string;
  stackId: string;
}) {
  return (
    <div className="rounded-none border border-gray-200 bg-white p-4 shadow-sm">
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
                dataKey="location"
                width={140}
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

export function GeographyBreakdownSection({
  registrationsByLocation,
  installedByLocation,
}: {
  registrationsByLocation: GeographyBreakdownRow[];
  installedByLocation: GeographyBreakdownRow[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <LocationBarChart
        title="Top locations (registrations)"
        data={registrationsByLocation}
        emptyMessage="No registration location data yet."
        stackId="geo-registrations"
      />
      <LocationBarChart
        title="Top locations (installed)"
        data={installedByLocation}
        emptyMessage="No installed location data yet."
        stackId="geo-installed"
      />
    </div>
  );
}
