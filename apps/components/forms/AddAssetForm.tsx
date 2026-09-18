"use client";

import { useEffect, useState } from "react";
import type { AssetType, LineType, Pole } from "@/lib/types";
import { GpsCaptureButton } from "./GpsCaptureButton";
import { PoleForm } from "./PoleForm";
import { CsvImportForm, type ParsedRow } from "./CsvImportForm";
import { apiFetch } from "@/lib/api";

const NAMEPLATE_FIELDS = [
  ["manufacturer", "Manufacturer", "text"],
  ["serial_number", "Serial number", "text"],
  ["manufacture_year", "Year", "number"],
  ["phase_configuration", "Phase configuration", "text"],
  ["rated_primary_voltage_kv", "Rated primary voltage (kV)", "number"],
  ["rated_secondary_voltage_v", "Rated secondary voltage (V)", "number"],
  ["rated_frequency_hz", "Rated frequency (Hz)", "number"],
  ["impedance_percent", "Impedance (%)", "number"],
  ["cooling_type", "Cooling type", "text"],
] as const;

type AddType = AssetType | "pole";
type Mode = "manual" | "import";

function num(row: Record<string, string>, key: string): number | undefined {
  if (!row[key]) return undefined;
  const n = Number(row[key]);
  return Number.isNaN(n) ? undefined : n;
}

function parsePoleRow(row: Record<string, string>): ParsedRow<{ label?: string; latitude: number; longitude: number }> {
  const latitude = num(row, "latitude");
  const longitude = num(row, "longitude");
  if (latitude === undefined) return { error: "invalid or missing latitude" };
  if (longitude === undefined) return { error: "invalid or missing longitude" };
  return { data: { label: row.label || undefined, latitude, longitude } };
}

function parseTransformerRow(row: Record<string, string>): ParsedRow<Record<string, unknown>> {
  if (!row.code) return { error: "code is required" };
  const latitude = num(row, "latitude");
  const longitude = num(row, "longitude");
  if (latitude === undefined) return { error: "invalid or missing latitude" };
  if (longitude === undefined) return { error: "invalid or missing longitude" };

  const data: Record<string, unknown> = { code: row.code, latitude, longitude };
  if (row.name) data.name = row.name;
  const capacity = num(row, "rated_capacity_kva");
  if (capacity !== undefined) data.rated_capacity_kva = capacity;
  for (const [key, , kind] of NAMEPLATE_FIELDS) {
    if (!row[key]) continue;
    data[key] = kind === "number" ? num(row, key) : row[key];
  }
  return { data };
}

function parseLineRow(row: Record<string, string>): ParsedRow<Record<string, unknown>> {
  if (!row.code) return { error: "code is required" };
  if (!row.pole_a_label) return { error: "pole_a_label is required" };
  if (!row.pole_b_label) return { error: "pole_b_label is required" };
  return {
    data: {
      code: row.code,
      name: row.name || undefined,
      line_type: row.line_type || undefined,
      conductor_type: row.conductor_type || undefined,
      pole_a_label: row.pole_a_label,
      pole_b_label: row.pole_b_label,
    },
  };
}

export function AddAssetForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [type, setType] = useState<AddType>("transformer");
  const [mode, setMode] = useState<Mode>("manual");
  const [poles, setPoles] = useState<Pole[]>([]);

  useEffect(() => {
    apiFetch("/api/poles")
      .then((res) => res.json())
      .then((payload) => setPoles(payload.data ?? []))
      .catch(() => setPoles([]));
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Type *</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AddType)}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="pole">Pole / Tiang</option>
          <option value="transformer">Transformer</option>
          <option value="line">Power Line (between 2 poles)</option>
        </select>
      </div>

      <div className="flex rounded border border-slate-300 p-0.5 text-sm dark:border-slate-700">
        {(["manual", "import"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded px-2 py-1 font-medium transition-colors ${
              mode === m
                ? "bg-slate-800 text-white dark:bg-amber-500 dark:text-slate-950"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            {m === "manual" ? "Manual" : "Import CSV"}
          </button>
        ))}
      </div>

      {type === "pole" && mode === "manual" && <PoleForm onSuccess={onSuccess} onCancel={onCancel} />}
      {type === "pole" && mode === "import" && (
        <CsvImportForm
          endpoint="/api/import/poles"
          templateHeader={["label", "latitude", "longitude"]}
          parseRow={parsePoleRow}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      )}

      {type === "transformer" && mode === "import" && (
        <CsvImportForm
          endpoint="/api/import/transformers"
          templateHeader={["code", "name", "rated_capacity_kva", "latitude", "longitude", "manufacturer", "..."]}
          parseRow={parseTransformerRow}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      )}

      {type === "line" && mode === "import" && (
        <CsvImportForm
          endpoint="/api/import/lines"
          templateHeader={["code", "name", "line_type", "conductor_type", "pole_a_label", "pole_b_label"]}
          parseRow={parseLineRow}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      )}

      {type !== "pole" && mode === "manual" && (
        <ManualAssetForm type={type} poles={poles} onSuccess={onSuccess} onCancel={onCancel} />
      )}
    </div>
  );
}

function ManualAssetForm({
  type,
  poles,
  onSuccess,
  onCancel,
}: {
  type: "transformer" | "line";
  poles: Pole[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [ratedCapacity, setRatedCapacity] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [poleLocationId, setPoleLocationId] = useState("");
  const [lineType, setLineType] = useState<LineType>("SUTM");
  const [conductorType, setConductorType] = useState("");
  const [poleAId, setPoleAId] = useState("");
  const [poleBId, setPoleBId] = useState("");
  const [nameplate, setNameplate] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function pickPoleLocation(poleId: string) {
    setPoleLocationId(poleId);
    const pole = poles.find((p) => p.id === poleId);
    if (pole) {
      setLat(String(pole.latitude));
      setLng(String(pole.longitude));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = { type, code, name: name || undefined };
    if (type === "transformer") {
      body.rated_capacity_kva = ratedCapacity ? Number(ratedCapacity) : undefined;
      body.latitude = Number(lat);
      body.longitude = Number(lng);
      for (const [key, , kind] of NAMEPLATE_FIELDS) {
        const v = nameplate[key];
        if (v) body[key] = kind === "number" ? Number(v) : v;
      }
    } else {
      body.line_type = lineType;
      body.conductor_type = conductorType || undefined;
      body.pole_a_id = poleAId;
      body.pole_b_id = poleBId;
    }

    const res = await apiFetch("/api/assets", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setSubmitting(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setError(payload?.message ?? "Failed to create asset.");
      return;
    }
    onSuccess();
  }

  const canSubmitLine = poleAId && poleBId && poleAId !== poleBId;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Code *</label>
        <input
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. GD-SMG-0143"
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "line" ? "Defaults to the 2 poles' labels" : undefined}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {type === "transformer" ? (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Rated capacity (kVA)</label>
            <input
              type="number"
              value={ratedCapacity}
              onChange={(e) => setRatedCapacity(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {poles.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Use pole location (optional)</label>
              <select
                value={poleLocationId}
                onChange={(e) => pickPoleLocation(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="">Custom location</option>
                {poles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label ?? p.id}
                  </option>
                ))}
              </select>
            </div>
          )}

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

          <details className="rounded border border-slate-200 p-2 dark:border-slate-700">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
              Nameplate details (optional)
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {NAMEPLATE_FIELDS.map(([key, label, kind]) => (
                <div key={key} className={key === "cooling_type" ? "col-span-2" : ""}>
                  <label className="block text-xs text-slate-500 dark:text-slate-400">{label}</label>
                  <input
                    type={kind}
                    value={nameplate[key] ?? ""}
                    onChange={(e) => setNameplate((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              ))}
            </div>
          </details>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Line type</label>
            <select
              value={lineType}
              onChange={(e) => setLineType(e.target.value as LineType)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="SUTM">SUTM</option>
              <option value="SKTM">SKTM</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Conductor type</label>
            <input
              value={conductorType}
              onChange={(e) => setConductorType(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {poles.length < 2 ? (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              A line connects 2 existing poles — add at least 2 poles first.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Pole A *</label>
                <select
                  required
                  value={poleAId}
                  onChange={(e) => setPoleAId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Select…</option>
                  {poles.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.id === poleBId}>
                      {p.label ?? p.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Pole B *</label>
                <select
                  required
                  value={poleBId}
                  onChange={(e) => setPoleBId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Select…</option>
                  {poles.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.id === poleAId}>
                      {p.label ?? p.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || (type === "line" && !canSubmitLine)}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
        >
          {submitting ? "Creating…" : "Create asset"}
        </button>
      </div>
    </form>
  );
}
