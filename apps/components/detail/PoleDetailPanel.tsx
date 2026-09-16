"use client";

import { useEffect, useState } from "react";
import type { PoleDetail } from "@/lib/types";
import { apiFetch } from "@/lib/api";

export function PoleDetailPanel({ poleId, onClose }: { poleId: string; onClose: () => void }) {
  const [pole, setPole] = useState<PoleDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await apiFetch(`/api/poles/${poleId}`);
      const payload = await res.json();
      setPole(res.ok ? payload.data : null);
      setLoading(false);
    }
    load();
  }, [poleId]);

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 sm:w-96">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{pole?.label ?? "Loading…"}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Pole / Tiang</p>
        </div>
        <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100">
          Close
        </button>
      </div>

      {loading && <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading…</p>}

      {pole && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-500 dark:text-slate-400">Latitude</dt>
            <dd>{pole.latitude.toFixed(5)}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Longitude</dt>
            <dd>{pole.longitude.toFixed(5)}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Registered</dt>
            <dd>{new Date(pole.created_at).toLocaleDateString("en-GB")}</dd>
          </dl>

          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Connected Lines ({pole.connectedLines.length})
            </h3>
            {pole.connectedLines.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No line uses this pole as an endpoint yet.</p>
            ) : (
              <ul className="space-y-1">
                {pole.connectedLines.map((line) => (
                  <li key={line.id} className="rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-800">
                    <p className="font-medium">{line.name ?? line.code}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{line.code}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-400">
            A pole carries no measurement itself — open a connected line to see its Point Measurements.
          </p>
        </>
      )}
    </aside>
  );
}
