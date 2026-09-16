"use client";

import { useState } from "react";
import { GpsCaptureButton } from "./GpsCaptureButton";
import { apiFetch } from "@/lib/api";

export function PoleForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await apiFetch("/api/poles", {
      method: "POST",
      body: JSON.stringify({ label: label || undefined, latitude: Number(lat), longitude: Number(lng) }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setError(payload?.message ?? "Failed to create pole.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Label</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Tiang 12"
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          required
          placeholder="Latitude"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <input
          required
          placeholder="Longitude"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <GpsCaptureButton
          onCapture={(la, lo) => {
            setLat(String(la));
            setLng(String(lo));
          }}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
        >
          {submitting ? "Creating…" : "Create pole"}
        </button>
      </div>
    </form>
  );
}
