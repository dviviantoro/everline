"use client";

import { useState } from "react";
import type { MeasurementPointListItem, Severity } from "@/lib/types";
import { GpsCaptureButton } from "./GpsCaptureButton";
import { uploadPdPhoto } from "@/lib/uploadPhoto";

export interface PointRowValue {
  measurement_point_id: string; // "" = custom point not tied to a registered measurement point
  point_label: string;
  latitude: string;
  longitude: string;
  pd_magnitude: string;
  pd_unit: string;
  temperature_c: string;
  severity: Severity | "";
  pd_device: string;
  photo_url: string;
}

export function PointRowInput({
  index,
  value,
  points,
  onChange,
  onRemove,
}: {
  index: number;
  value: PointRowValue;
  points: MeasurementPointListItem[];
  onChange: (next: PointRowValue) => void;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function set<K extends keyof PointRowValue>(key: K, v: PointRowValue[K]) {
    onChange({ ...value, [key]: v });
  }

  function selectPoint(pointId: string) {
    const point = points.find((p) => p.id === pointId);
    if (!point) {
      onChange({ ...value, measurement_point_id: "" });
      return;
    }
    onChange({
      ...value,
      measurement_point_id: pointId,
      point_label: point.label ?? "",
      latitude: String(point.latitude),
      longitude: String(point.longitude),
    });
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadPdPhoto(file);
      set("photo_url", url);
    } catch (err) {
      setUploadError((err as Error).message);
    }
    setUploading(false);
  }

  return (
    <div className="space-y-2 rounded border border-slate-200 p-2 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Point {index + 1}</span>
        <button type="button" onClick={onRemove} className="text-xs text-red-600 dark:text-red-400">
          Remove
        </button>
      </div>

      {points.length > 0 && (
        <select
          value={value.measurement_point_id}
          onChange={(e) => selectPoint(e.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">Custom point (not on file)</option>
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label ?? `Point ${p.sequence_no}`}
            </option>
          ))}
        </select>
      )}

      {!value.measurement_point_id && (
        <input
          placeholder="Label (e.g. Point 2)"
          value={value.point_label}
          onChange={(e) => set("point_label", e.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      )}

      <div className="flex items-center gap-2">
        <input
          placeholder="Latitude"
          value={value.latitude}
          onChange={(e) => set("latitude", e.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <input
          placeholder="Longitude"
          value={value.longitude}
          onChange={(e) => set("longitude", e.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <GpsCaptureButton
          onCapture={(lat, lng) => onChange({ ...value, latitude: String(lat), longitude: String(lng) })}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <input
          placeholder="PD magnitude"
          value={value.pd_magnitude}
          onChange={(e) => set("pd_magnitude", e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <input
          placeholder="Unit (dBmV, pC…)"
          value={value.pd_unit}
          onChange={(e) => set("pd_unit", e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <input
          placeholder="Temp (°C)"
          value={value.temperature_c}
          onChange={(e) => set("temperature_c", e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      <input
        placeholder="PD device (e.g. Doble PDS-100)"
        value={value.pd_device}
        onChange={(e) => set("pd_device", e.target.value)}
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />

      <select
        value={value.severity}
        onChange={(e) => set("severity", e.target.value as Severity | "")}
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      >
        <option value="">Severity —</option>
        <option value="normal">Normal</option>
        <option value="warning">Warning</option>
        <option value="critical">Critical</option>
      </select>

      <div className="flex items-center gap-2">
        {value.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset
          <img src={value.photo_url} alt="PD evidence" className="h-10 w-10 rounded object-cover" />
        ) : null}
        <label className="flex-1 rounded border border-dashed border-slate-300 px-2 py-1 text-center text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          {uploading ? "Uploading…" : value.photo_url ? "Replace photo" : "Attach photo evidence"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => handlePhoto(e.target.files?.[0])}
          />
        </label>
      </div>
      {uploadError && <p className="text-xs text-red-600 dark:text-red-400">{uploadError}</p>}
    </div>
  );
}

export const emptyPointRow = (): PointRowValue => ({
  measurement_point_id: "",
  point_label: "",
  latitude: "",
  longitude: "",
  pd_magnitude: "",
  pd_unit: "",
  temperature_c: "",
  severity: "",
  pd_device: "",
  photo_url: "",
});
