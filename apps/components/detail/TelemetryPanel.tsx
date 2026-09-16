"use client";

import { useEffect, useState } from "react";
import type { TelemetryPoint } from "@/lib/types";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { toCsv, downloadCsv } from "@/lib/csv";
import { apiFetch } from "@/lib/api";

const METRICS: { key: keyof TelemetryPoint; label: string; unit: string; color: string }[] = [
  { key: "kw", label: "Active Power", unit: "kW", color: "#f59e0b" },
  { key: "kva", label: "Apparent Power", unit: "kVA", color: "#0ea5e9" },
  { key: "kvar", label: "Reactive Power", unit: "kVAr", color: "#8b5cf6" },
  { key: "power_factor", label: "Power Factor", unit: "", color: "#22c55e" },
  { key: "voltage_v", label: "Voltage", unit: "V", color: "#ef4444" },
  { key: "current_a", label: "Current", unit: "A", color: "#06b6d4" },
  { key: "frequency_hz", label: "Frequency", unit: "Hz", color: "#a855f7" },
  { key: "demand_kva", label: "Demand", unit: "kVA", color: "#f97316" },
  { key: "thd_percent", label: "THD", unit: "%", color: "#dc2626" },
  { key: "kwh", label: "Energy (kWh)", unit: "kWh", color: "#14b8a6" },
  { key: "kvarh", label: "Reactive Energy (kVArh)", unit: "kVArh", color: "#6366f1" },
];

const RANGES = [
  { hours: 24, label: "24h" },
  { hours: 72, label: "3d" },
];

export function TelemetryPanel({
  assetId,
  latitude,
  longitude,
}: {
  assetId: string;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const [points, setPoints] = useState<TelemetryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [metricKey, setMetricKey] = useState<keyof TelemetryPoint>("kw");

  useEffect(() => {
    // No setState before the first await, so this never fires synchronously
    // from the effect body — the chart just updates in place when data
    // arrives instead of flashing a loading state on every range switch.
    let cancelled = false;
    async function load() {
      const res = await apiFetch(`/api/assets/${assetId}/telemetry?hours=${hours}`);
      const payload = await res.json();
      if (!cancelled && res.ok) setPoints(payload.data);
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [assetId, hours]);

  const metric = METRICS.find((m) => m.key === metricKey)!;
  const latest = points[points.length - 1];

  function exportCsv() {
    const columns = [
      { key: "recorded_at" as const, header: "Recorded At" },
      ...METRICS.map((m) => ({ key: m.key, header: m.label })),
    ];
    downloadCsv(`telemetry-${assetId}.csv`, toCsv(points, columns));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        {latitude != null && longitude != null ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Position: {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1">
          {points.length > 0 && (
            <button
              onClick={exportCsv}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Export CSV
            </button>
          )}
          {RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setHours(r.hours)}
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                hours === r.hours
                  ? "bg-slate-800 text-white dark:bg-amber-500 dark:text-slate-950"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {latest && (
        <div className="mb-2 grid grid-cols-3 gap-1.5 text-xs">
          <Stat label="Phase" value={latest.number_of_phase ?? "—"} />
          <Stat label="kW" value={latest.kw ?? "—"} />
          <Stat label="PF" value={latest.power_factor ?? "—"} />
        </div>
      )}

      <select
        value={metricKey}
        onChange={(e) => setMetricKey(e.target.value as keyof TelemetryPoint)}
        className="mb-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      >
        {METRICS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <TimeSeriesChart
          data={points as unknown as Record<string, unknown>[]}
          xKey="recorded_at"
          series={[{ key: metricKey, label: metric.label, color: metric.color, unit: metric.unit || undefined }]}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded bg-slate-50 px-1.5 py-1 text-center dark:bg-slate-800">
      <div className="text-slate-400 dark:text-slate-500">{label}</div>
      <div className="font-medium text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  );
}
