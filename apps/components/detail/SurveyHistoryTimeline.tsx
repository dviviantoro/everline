"use client";

import { useState } from "react";
import type { LineSurveyEntry, TransformerSurveyEntry } from "@/lib/types";
import { SeverityBadge } from "./SeverityBadge";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function TransformerEntryDetail({
  entry,
  assetPosition,
}: {
  entry: TransformerSurveyEntry;
  assetPosition?: { latitude: number | null; longitude: number | null };
}) {
  const r = entry.reading;
  if (!r) return <p className="text-sm text-slate-500 dark:text-slate-400">No reading recorded for this visit.</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {assetPosition?.latitude != null && assetPosition?.longitude != null && (
        <>
          <dt className="text-slate-500 dark:text-slate-400">Position</dt>
          <dd>
            {assetPosition.latitude.toFixed(5)}, {assetPosition.longitude.toFixed(5)}
          </dd>
        </>
      )}
      <dt className="text-slate-500 dark:text-slate-400">Voltage (primary/secondary)</dt>
      <dd>
        {r.voltage_primary_kv ?? "—"} kV / {r.voltage_secondary_v ?? "—"} V
      </dd>
      <dt className="text-slate-500 dark:text-slate-400">Current R/S/T</dt>
      <dd>
        {r.current_r_a ?? "—"} / {r.current_s_a ?? "—"} / {r.current_t_a ?? "—"} A
      </dd>
      <dt className="text-slate-500 dark:text-slate-400">Load</dt>
      <dd>{r.load_percent != null ? `${r.load_percent}%` : "—"}</dd>
      <dt className="text-slate-500 dark:text-slate-400">Oil / ambient temp</dt>
      <dd>
        {r.oil_temp_c ?? "—"} °C / {r.ambient_temp_c ?? "—"} °C
      </dd>
      <dt className="text-slate-500 dark:text-slate-400">Condition</dt>
      <dd>
        <SeverityBadge value={r.condition} />
      </dd>
    </dl>
  );
}

function LineEntryDetail({ entry }: { entry: LineSurveyEntry }) {
  if (entry.points.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">No points recorded for this visit.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {entry.points.map((p, i) => (
        <li key={i} className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <span>{p.point_label ?? `Point ${p.sequence_no ?? i + 1}`}</span>
            <span className="text-slate-500 dark:text-slate-400">
              {p.pd_magnitude ?? "—"} {p.pd_unit ?? ""} · {p.temperature_c ?? "—"}°C
            </span>
            <SeverityBadge value={p.severity} />
          </div>
          <span className="text-xs text-slate-400">
            {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SurveyHistoryTimeline({
  surveys,
  type,
  assetPosition,
}: {
  surveys: (TransformerSurveyEntry | LineSurveyEntry)[];
  type: "transformer" | "line";
  assetPosition?: { latitude: number | null; longitude: number | null };
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (surveys.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No surveys recorded yet.</p>;
  }

  return (
    <ul className="divide-y divide-slate-200 dark:divide-slate-800">
      {surveys.map((entry) => {
        const isOpen = expanded.has(entry.id);
        return (
          <li key={entry.id} className="py-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(entry.id)) next.delete(entry.id);
                  else next.add(entry.id);
                  return next;
                })
              }
            >
              <span className="text-sm font-medium">{formatDate(entry.surveyed_at)}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{entry.surveyor ?? "Unknown surveyor"}</span>
            </button>
            {isOpen && (
              <div className="mt-2 space-y-2">
                {type === "transformer" ? (
                  <TransformerEntryDetail entry={entry as TransformerSurveyEntry} assetPosition={assetPosition} />
                ) : (
                  <LineEntryDetail entry={entry as LineSurveyEntry} />
                )}
                {entry.notes && (
                  <p className="text-sm italic text-slate-500 dark:text-slate-400">&ldquo;{entry.notes}&rdquo;</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
