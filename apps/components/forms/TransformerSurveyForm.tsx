"use client";

import { useState } from "react";
import type { Condition } from "@/lib/types";
import { apiFetch } from "@/lib/api";

const NUMERIC_FIELDS = [
  ["voltage_primary_kv", "Voltage primary (kV)"],
  ["voltage_secondary_v", "Voltage secondary (V)"],
  ["current_r_a", "Current R (A)"],
  ["current_s_a", "Current S (A)"],
  ["current_t_a", "Current T (A)"],
  ["load_percent", "Load (%)"],
  ["oil_temp_c", "Oil temp (°C)"],
  ["ambient_temp_c", "Ambient temp (°C)"],
] as const;

export function TransformerSurveyForm({
  assetId,
  onSuccess,
  onCancel,
}: {
  assetId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [surveyor, setSurveyor] = useState("");
  const [condition, setCondition] = useState<Condition | "">("");
  const [notes, setNotes] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = { surveyor, notes: notes || undefined };
    if (condition) body.condition = condition;
    for (const [key] of NUMERIC_FIELDS) {
      if (values[key]) body[key] = Number(values[key]);
    }

    const res = await apiFetch(`/api/assets/${assetId}/transformer-surveys`, {
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

      <div className="grid grid-cols-2 gap-2">
        {NUMERIC_FIELDS.map(([key, label]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</label>
            <input
              type="number"
              step="any"
              value={values[key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        ))}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Condition</label>
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value as Condition | "")}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">—</option>
          <option value="good">Good</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>

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
          disabled={submitting}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
        >
          {submitting ? "Submitting…" : "Submit survey"}
        </button>
      </div>
    </form>
  );
}
