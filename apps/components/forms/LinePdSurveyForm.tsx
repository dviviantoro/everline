"use client";

import { useEffect, useState } from "react";
import type { MeasurementPointListItem } from "@/lib/types";
import { PointRowInput, emptyPointRow, type PointRowValue } from "./PointRowInput";
import { apiFetch } from "@/lib/api";

export function LinePdSurveyForm({
  assetId,
  onSuccess,
  onCancel,
}: {
  assetId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [surveyor, setSurveyor] = useState("");
  const [notes, setNotes] = useState("");
  const [points, setPoints] = useState<PointRowValue[]>([emptyPointRow()]);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPointListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch(`/api/assets/${assetId}/measurement-points`)
      .then((res) => res.json())
      .then((payload) => setMeasurementPoints(payload.data ?? []))
      .catch(() => setMeasurementPoints([]));
  }, [assetId]);

  const canSubmit = points.some((p) => p.latitude && p.longitude);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const body = {
      surveyor,
      notes: notes || undefined,
      points: points
        .filter((p) => p.latitude && p.longitude)
        .map((p, i) => ({
          measurement_point_id: p.measurement_point_id || undefined,
          sequence_no: i + 1,
          point_label: p.point_label || undefined,
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
          pd_magnitude: p.pd_magnitude ? Number(p.pd_magnitude) : undefined,
          pd_unit: p.pd_unit || undefined,
          temperature_c: p.temperature_c ? Number(p.temperature_c) : undefined,
          severity: p.severity || undefined,
          pd_device: p.pd_device || undefined,
          photo_url: p.photo_url || undefined,
        })),
    };

    const res = await apiFetch(`/api/assets/${assetId}/pd-surveys`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setSubmitting(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setError(payload?.message ?? "Failed to submit survey.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Surveyor *</label>
        <input
          required
          value={surveyor}
          onChange={(e) => setSurveyor(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      <div className="space-y-2">
        {points.map((point, i) => (
          <PointRowInput
            key={i}
            index={i}
            value={point}
            points={measurementPoints}
            onChange={(next) => setPoints((prev) => prev.map((p, idx) => (idx === i ? next : p)))}
            onRemove={() => setPoints((prev) => prev.filter((_, idx) => idx !== i))}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setPoints((prev) => [...prev, emptyPointRow()])}
        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        + Add point
      </button>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          rows={2}
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !canSubmit}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
        >
          {submitting ? "Submitting…" : "Submit patrol"}
        </button>
      </div>
    </form>
  );
}
