"use client";

import { useEffect, useState } from "react";
import type { MeasurementPointDetail } from "@/lib/types";
import { SeverityBadge } from "./SeverityBadge";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { PdTrendFooter } from "./PdTrendFooter";
import { PD_CHART_ZONES } from "@/lib/severity";
import { toCsv, downloadCsv } from "@/lib/csv";
import { apiFetch } from "@/lib/api";

export function MeasurementPointDetailPanel({ pointId, onClose }: { pointId: string; onClose: () => void }) {
  const [point, setPoint] = useState<MeasurementPointDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await apiFetch(`/api/measurement-points/${pointId}`);
      const payload = await res.json();
      setPoint(res.ok ? payload.data : null);
      setLoading(false);
    }
    load();
  }, [pointId]);

  const chartData = (point?.readings ?? [])
    .slice()
    .reverse() // chart wants oldest-first
    .map((r) => ({
      surveyed_at: r.surveyed_at,
      pd_magnitude: r.pd_magnitude,
      temperature_c: r.temperature_c,
    }));

  function exportCsv() {
    if (!point) return;
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
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:w-96">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{point?.label ?? "Loading…"}</h2>
          {point && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              PD Measurement on {point.asset_name ?? point.asset_code} ({point.asset_code})
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800">
          Close
        </button>
      </div>

      {loading && <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading…</p>}

      {point && (
        <>
          <div className="mt-4 flex items-center justify-between">
            <SeverityBadge value={point.readings[0]?.severity} />
            {point.readings.length > 0 && (
              <button onClick={exportCsv} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                Export CSV
              </button>
            )}
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500 dark:text-slate-400">Position</dt>
            <dd>
              {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
            </dd>
            {point.readings[0] && (
              <>
                <dt className="text-slate-500 dark:text-slate-400">Last value of PD magnitude</dt>
                <dd>
                  {point.readings[0].pd_magnitude ?? "—"} {point.readings[0].pd_unit ?? ""}
                </dd>
                <dt className="text-slate-500 dark:text-slate-400">Last value of temperature</dt>
                <dd>{point.readings[0].temperature_c ?? "—"} °C</dd>
                <dt className="text-slate-500 dark:text-slate-400">Last device</dt>
                <dd>{point.readings[0].pd_device ?? "—"}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Last surveyed operator</dt>
                <dd>{point.readings[0].surveyor ?? "—"}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Last surveyed</dt>
                <dd>{new Date(point.readings[0].surveyed_at).toLocaleDateString("en-GB")}</dd>
              </>
            )}
          </dl>

          {point.readings.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No PD readings recorded at this point yet.</p>
          ) : (
            <>
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">PD Magnitude History</h3>
                <TimeSeriesChart
                  data={chartData}
                  xKey="surveyed_at"
                  series={[
                    {
                      key: "pd_magnitude",
                      label: "PD magnitude",
                      color: "#dc2626",
                      unit: point.readings[0]?.pd_unit ?? undefined,
                    },
                  ]}
                  zones={PD_CHART_ZONES}
                  height={160}
                />
                <PdTrendFooter readings={point.readings} unit={point.readings[0]?.pd_unit ?? undefined} />
              </div>

              <div className="mt-5">
                <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Temperature History</h3>
                <TimeSeriesChart
                  data={chartData}
                  xKey="surveyed_at"
                  series={[{ key: "temperature_c", label: "Temperature", color: "#f59e0b", unit: "°C" }]}
                  height={160}
                />
              </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}
