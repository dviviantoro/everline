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
