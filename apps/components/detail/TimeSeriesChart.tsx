"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  unit?: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function TimeSeriesChart({
  data,
  xKey,
  series,
  height = 220,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: ChartSeries[];
  height?: number;
}) {
  if (data.length === 0) {
    return (
      <div
        className="flex h-[220px] items-center justify-center text-sm text-slate-500 dark:text-slate-400"
        style={{ height }}
      >
        No data in this range yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis
          dataKey={xKey}
          tickFormatter={formatTime}
          tick={{ fontSize: 10, fill: "var(--chart-axis)" }}
          minTickGap={30}
        />
        <YAxis tick={{ fontSize: 10, fill: "var(--chart-axis)" }} width={36} />
        <Tooltip
          labelFormatter={(v) => formatTime(String(v))}
          contentStyle={{
            fontSize: 12,
            borderRadius: 6,
            background: "var(--chart-tooltip-bg)",
            color: "var(--chart-tooltip-text)",
            border: "1px solid var(--chart-tooltip-border)",
          }}
          formatter={(value, name) => {
            const s = series.find((s) => s.label === name);
            const display = s?.unit ? `${value} ${s.unit}` : String(value);
            return [display, String(name)];
          }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
