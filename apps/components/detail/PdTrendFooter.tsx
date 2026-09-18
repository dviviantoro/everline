"use client";

import { PD_CHART_ZONES, agingRate } from "@/lib/severity";

/**
 * Zone key plus the aging rate for a PD magnitude chart. The slope is the
 * useful part: a point sitting in the normal band but climbing steeply matters
 * more than one parked just inside caution.
 */
export function PdTrendFooter({
  readings,
  unit = "dBmV",
}: {
  readings: { surveyed_at: string; pd_magnitude: number | null }[];
  unit?: string;
}) {
  const rate = agingRate(readings);
  const sign = (n: number) => (n >= 0 ? "+" : "");

  return (
    <div className="mt-1 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
        {PD_CHART_ZONES.map((z) => (
          <span key={z.label} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2.5 rounded-sm" style={{ background: z.color, opacity: 0.5 }} />
            {z.label}
            <span className="text-slate-400 dark:text-slate-500">
              {z.to >= 999 ? `≥ ${z.from}` : `${z.from}–${z.to}`}
            </span>
          </span>
        ))}
      </div>

      {rate ? (
        <p className="text-slate-600 dark:text-slate-300">
          <span className="font-semibold">Aging rate:</span> {sign(rate.perMonth)}
          {rate.perMonth.toFixed(2)} {unit}/month ({sign(rate.perYear)}
          {rate.perYear.toFixed(1)} {unit}/year) over {rate.monthsSpanned.toFixed(0)} months
        </p>
      ) : (
        <p className="text-slate-500 dark:text-slate-400">
          Aging rate needs at least two readings taken at different times.
        </p>
      )}
    </div>
  );
}
