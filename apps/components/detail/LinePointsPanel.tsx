"use client";

import { useEffect, useState } from "react";
import type { MeasurementPointWithReadings } from "@/lib/types";
import { SeverityBadge } from "./SeverityBadge";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { CollapsibleSection } from "./CollapsibleSection";
import { toCsv, downloadCsv } from "@/lib/csv";
import { apiFetch } from "@/lib/api";

export function LinePointsPanel({ assetId }: { assetId: string }) {
  const [points, setPoints] = useState<MeasurementPointWithReadings[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await apiFetch(`/api/assets/${assetId}/points`);
      const payload = await res.json();
      if (!cancelled && res.ok) setPoints(payload.data);
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (loading) return <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>;
  if (points.length === 0) return <p className="text-sm text-slate-500 dark:text-slate-400">No points registered on this line yet.</p>;

  return (
    <div className="space-y-2">
      {points.map((point, i) => (
        <PointRow key={point.id} point={point} index={i} />
      ))}
    </div>
  );
}

function PointRow({ point, index }: { point: MeasurementPointWithReadings; index: number }) {
  const latest = point.readings[0];
  const chartData = point.readings
    .slice()
    .reverse() // chart wants oldest-first
    .map((r) => ({
      surveyed_at: r.surveyed_at,
      pd_magnitude: r.pd_magnitude,
      temperature_c: r.temperature_c,
    }));

  function exportCsv() {
    const csv = toCsv(point.readings, [
      { key: "surveyed_at", header: "Surveyed At" },
      { key: "surveyor", header: "Surveyor" },
      { key: "pd_magnitude", header: "PD Magnitude" },
      { key: "pd_unit", header: "Unit" },
      { key: "temperature_c", header: "Temperature (C)" },
      { key: "severity", header: "Severity" },
      { key: "pd_device", header: "PD Device" },
      { key: "photo_url", header: "Photo URL" },
    ]);
    downloadCsv(`${point.label ?? "pd-measurement"}-history.csv`, csv);
  }

  return (
    <div className="rounded border border-slate-200 p-2 dark:border-slate-800">
      <CollapsibleSection
        title={point.label ?? `Point ${point.sequence_no ?? index + 1}`}
        defaultOpen={false}
        right={<SeverityBadge value={latest?.severity} />}
      >
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500 dark:text-slate-400">Position</dt>
            <dd>
              {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
            </dd>
            <dt className="text-slate-500 dark:text-slate-400">Last PD magnitude</dt>
            <dd>{latest ? `${latest.pd_magnitude ?? "—"} ${latest.pd_unit ?? ""}` : "—"}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Last temperature</dt>
            <dd>{latest?.temperature_c ?? "—"} °C</dd>
            <dt className="text-slate-500 dark:text-slate-400">PD device</dt>
            <dd>{latest?.pd_device ?? "—"}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Last measured</dt>
            <dd>{latest ? new Date(latest.surveyed_at).toLocaleDateString("en-GB") : "—"}</dd>
          </dl>

          {latest?.photo_url && (
            <a href={latest.photo_url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset */}
              <img src={latest.photo_url} alt="PD evidence" className="h-16 w-16 rounded object-cover" />
            </a>
          )}

          {point.readings.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">No measurements recorded at this point yet.</p>
          ) : (
            <>
              <div className="flex justify-end">
                <button onClick={exportCsv} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  Export CSV
                </button>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">PD Magnitude History</h4>
                <TimeSeriesChart
                  data={chartData}
                  xKey="surveyed_at"
                  series={[{ key: "pd_magnitude", label: "PD magnitude", color: "#dc2626", unit: latest?.pd_unit ?? undefined }]}
                  height={140}
                />
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Temperature History</h4>
                <TimeSeriesChart
                  data={chartData}
                  xKey="surveyed_at"
                  series={[{ key: "temperature_c", label: "Temperature", color: "#f59e0b", unit: "°C" }]}
                  height={140}
                />
              </div>
            </>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
