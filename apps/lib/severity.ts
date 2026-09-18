import type { Condition, Severity } from "./types";

const SEVERITY_RANK: Record<Severity, number> = { normal: 0, warning: 1, critical: 2 };
const CONDITION_RANK: Record<Condition, number> = { good: 0, warning: 1, critical: 2 };

/** Worst (highest-rank) severity among a set of PD points from one survey. */
export function worstSeverity(severities: (Severity | null)[]): Severity | null {
  let worst: Severity | null = null;
  for (const s of severities) {
    if (!s) continue;
    if (!worst || SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

export function conditionRank(c: Condition | null): number {
  return c ? CONDITION_RANK[c] : -1;
}

export function severityRank(s: Severity | null): number {
  return s ? SEVERITY_RANK[s] : -1;
}

// PD magnitude zone boundaries, in dBmV. These are the same cut-offs the
// backend uses to label a reading's severity — repeated here because the chart
// needs the boundaries themselves to draw its bands, not just the label.
// Provisional numbers: PLN's real PD thresholds aren't defined yet.
export const PD_ZONES = {
  cautionFrom: 20,
  dangerFrom: 40,
} as const;

export const PD_CHART_ZONES = [
  { from: 0, to: PD_ZONES.cautionFrom, color: "#059669", label: "Normal" },
  { from: PD_ZONES.cautionFrom, to: PD_ZONES.dangerFrom, color: "#d97706", label: "Caution" },
  { from: PD_ZONES.dangerFrom, to: 999, color: "#dc2626", label: "Danger" },
];

export interface AgingRate {
  perMonth: number;
  perYear: number;
  monthsSpanned: number;
}

/**
 * Least-squares slope of PD magnitude against time — how fast discharge
 * activity is climbing at a point, which is what "aging" means for this asset.
 * Returns null unless there are at least two readings spanning real time.
 */
export function agingRate(
  readings: { surveyed_at: string; pd_magnitude: number | null }[]
): AgingRate | null {
  const pts = readings
    .map((r) => ({ t: new Date(r.surveyed_at).getTime(), v: Number(r.pd_magnitude) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  const DAY = 86_400_000;
  const xs = pts.map((p) => (p.t - pts[0].t) / DAY);
  const ys = pts.map((p) => p.v);
  const n = pts.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;

  const perDay = num / den;
  return {
    perMonth: perDay * 30,
    perYear: perDay * 365,
    monthsSpanned: (xs[n - 1] - xs[0]) / 30,
  };
}
